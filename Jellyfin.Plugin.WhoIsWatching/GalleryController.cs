// SPDX-License-Identifier: GPL-3.0-only

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using MediaBrowser.Common.Api;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.WhoIsWatching;

/// <summary>
/// The picker's brand settings and the shared profile-picture gallery. Pictures are files named by
/// a server-made GUID in plugins/configurations/WhoIsWatching/images, so no client-supplied name
/// ever reaches the file system. Choosing a picture copies it to the user through Jellyfin's own
/// user-image API, which applies Jellyfin's permission checks; deleting one here leaves those copies.
/// </summary>
[ApiController]
[Route("WhoIsWatching")]
public sealed partial class GalleryController : ControllerBase
{
    // The client sends a 512 px JPEG (typically under 150 KB); the caps bound what one user can store.
    private const int MaxImageBytes = 1024 * 1024;
    private const int MaxImages = 200;

    private static readonly Dictionary<string, string> ContentTypes = new()
    {
        [".jpg"] = "image/jpeg",
        [".png"] = "image/png",
        [".webp"] = "image/webp"
    };

    private readonly IUserManager _userManager;
    private readonly string _folder;

    /// <summary>
    /// Initializes a new instance of the <see cref="GalleryController"/> class.
    /// </summary>
    /// <param name="userManager">User manager.</param>
    /// <param name="applicationPaths">Application paths.</param>
    public GalleryController(IUserManager userManager, IApplicationPaths applicationPaths)
    {
        _userManager = userManager;
        _folder = Path.Combine(applicationPaths.PluginConfigurationsPath, "WhoIsWatching", "images");
    }

    /// <summary>
    /// Gets the brand text settings, validated.
    /// </summary>
    /// <returns>The settings.</returns>
    [HttpGet("Settings")]
    [Authorize]
    public BrandSettings GetSettings()
    {
        var config = Plugin.Instance?.Configuration ?? new PluginConfiguration();
        var text = (config.BrandText ?? string.Empty).Trim();
        return new BrandSettings(
            text.Length > 40 ? text[..40] : text,
            config.BrandColor is { } color && ColorPattern().IsMatch(color) ? color : "#AA5CC3",
            Math.Clamp(config.BrandSize, 12, 120),
            config.BrandPosition is "TopCenter" or "TopRight" ? config.BrandPosition : "TopLeft");
    }

    /// <summary>
    /// Lists the gallery, newest first.
    /// </summary>
    /// <returns>Picture IDs.</returns>
    [HttpGet("Images")]
    [Authorize]
    public IEnumerable<string> GetImages()
        => Pictures().OrderByDescending(p => System.IO.File.GetLastWriteTimeUtc(p.Path)).Select(p => p.Id).ToList();

    /// <summary>
    /// Gets a gallery picture. Anonymous like Jellyfin's own user images, since an img tag can't send a
    /// token; IDs are random GUIDs and the list itself needs a signed-in user.
    /// </summary>
    /// <param name="id">Picture ID.</param>
    /// <returns>The picture.</returns>
    [HttpGet("Images/{id:guid}")]
    [AllowAnonymous]
    public ActionResult GetImage(Guid id)
    {
        var picture = Pictures().FirstOrDefault(p => p.Id == id.ToString("N"));
        if (picture.Path is null)
        {
            return NotFound();
        }

        // A picture never changes under its ID. nosniff and the sandbox keep a crafted file from
        // ever being treated as anything but an image.
        Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        Response.Headers.XContentTypeOptions = "nosniff";
        Response.Headers.ContentSecurityPolicy = "default-src 'none'; sandbox";
        return PhysicalFile(picture.Path, ContentTypes[Path.GetExtension(picture.Path)]);
    }

    /// <summary>
    /// Adds a picture to the gallery: a JPEG, PNG or WebP body of at most 1 MB. Allowed for anyone who
    /// may change their own profile picture in Jellyfin.
    /// </summary>
    /// <returns>The new picture's ID.</returns>
    [HttpPost("Images")]
    [Authorize]
    public async Task<ActionResult> AddImage()
    {
        if (!MayManageOwnPreferences())
        {
            return StatusCode(StatusCodes.Status403Forbidden);
        }

        var data = new byte[MaxImageBytes + 1];
        var length = 0;
        int read;
        while (length < data.Length && (read = await Request.Body.ReadAsync(data.AsMemory(length), HttpContext.RequestAborted).ConfigureAwait(false)) > 0)
        {
            length += read;
        }

        if (length > MaxImageBytes)
        {
            return StatusCode(StatusCodes.Status413PayloadTooLarge);
        }

        var extension = Sniff(data.AsSpan(0, length));
        if (extension is null)
        {
            return BadRequest("Not a JPEG, PNG or WebP image.");
        }

        Directory.CreateDirectory(_folder);
        if (Pictures().Count() >= MaxImages)
        {
            return Conflict("The gallery is full. Remove pictures in the plugin's settings.");
        }

        var id = Guid.NewGuid().ToString("N");
        var path = Path.Combine(_folder, id + extension);
        await System.IO.File.WriteAllBytesAsync(path + ".tmp", data.AsMemory(0, length), HttpContext.RequestAborted).ConfigureAwait(false);
        System.IO.File.Move(path + ".tmp", path);
        return Ok(new { Id = id });
    }

    /// <summary>
    /// Removes a gallery picture. Administrators only.
    /// </summary>
    /// <param name="id">Picture ID.</param>
    /// <returns>No content.</returns>
    [HttpDelete("Images/{id:guid}")]
    [Authorize(Policy = Policies.RequiresElevation)]
    public ActionResult DeleteImage(Guid id)
    {
        var picture = Pictures().FirstOrDefault(p => p.Id == id.ToString("N"));
        if (picture.Path is null)
        {
            return NotFound();
        }

        System.IO.File.Delete(picture.Path);
        return NoContent();
    }

    private IEnumerable<(string Id, string Path)> Pictures()
        => Directory.Exists(_folder)
            ? Directory.EnumerateFiles(_folder)
                .Select(path => (Id: Path.GetFileNameWithoutExtension(path), Path: path))
                .Where(p => Guid.TryParseExact(p.Id, "N", out _) && ContentTypes.ContainsKey(Path.GetExtension(p.Path)))
            : [];

    // The same rule Jellyfin applies to changing your own profile picture. The role and claim names
    // are Jellyfin.Api's UserRoles.Administrator and InternalClaimTypes.UserId.
    private bool MayManageOwnPreferences()
        => User.IsInRole("Administrator")
            || (Guid.TryParse(User.FindFirst("Jellyfin-UserId")?.Value, out var userId)
                && _userManager.GetUserById(userId) is { EnableUserPreferenceAccess: true });

    private static string? Sniff(ReadOnlySpan<byte> data)
    {
        if (data.StartsWith((ReadOnlySpan<byte>)[0xFF, 0xD8, 0xFF]))
        {
            return ".jpg";
        }

        if (data.StartsWith((ReadOnlySpan<byte>)[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))
        {
            return ".png";
        }

        return data.Length > 12 && data[..4].SequenceEqual("RIFF"u8) && data[8..12].SequenceEqual("WEBP"u8) ? ".webp" : null;
    }

    [GeneratedRegex("^#[0-9A-Fa-f]{6}$")]
    private static partial Regex ColorPattern();
}

/// <summary>
/// The picker's brand text.
/// </summary>
/// <param name="Text">Text; empty hides it.</param>
/// <param name="Color">Colour as #RRGGBB.</param>
/// <param name="Size">Size in pixels.</param>
/// <param name="Position">TopLeft, TopCenter or TopRight.</param>
public sealed record BrandSettings(string Text, string Color, int Size, string Position);
