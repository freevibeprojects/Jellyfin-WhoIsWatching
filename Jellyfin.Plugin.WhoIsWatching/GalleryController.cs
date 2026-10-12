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
/// The picker's brand settings and the shared profile-picture gallery. Pictures are JPEG files named
/// by a server-made GUID in plugins/configurations/WhoIsWatching/images, so no client-supplied name
/// ever reaches the file system. Choosing a picture copies it to the user through Jellyfin's own
/// user-image API, which applies Jellyfin's permission checks; deleting one here leaves those copies.
/// Only JPEG is accepted (the picker always sends JPEG): every profile's browser decodes these files,
/// and fewer decoders mean less attack surface (WebP's had remote code execution, CVE-2023-4863).
/// </summary>
[ApiController]
[Route("WhoIsWatching")]
public sealed partial class GalleryController : ControllerBase
{
    // The client sends a 512 px JPEG (typically under 150 KB); the caps bound what one user can store.
    private const int MaxImageBytes = 1024 * 1024;
    private const int MaxImages = 200;

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
        => Pictures().OrderByDescending(System.IO.File.GetLastWriteTimeUtc).Select(path => Path.GetFileNameWithoutExtension(path)!).ToList();

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
        var path = PathOf(id);
        if (!System.IO.File.Exists(path))
        {
            return NotFound();
        }

        // A picture never changes under its ID. nosniff and the sandbox keep a crafted file from
        // ever being treated as anything but an image.
        Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        Response.Headers.XContentTypeOptions = "nosniff";
        Response.Headers.ContentSecurityPolicy = "default-src 'none'; sandbox";
        return PhysicalFile(path, "image/jpeg");
    }

    /// <summary>
    /// Adds a picture to the gallery: a JPEG body of at most 1 MB. Allowed for anyone who
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

        if (Request.ContentLength > MaxImageBytes)
        {
            return StatusCode(StatusCodes.Status413PayloadTooLarge);
        }

        // Sized from Content-Length (Kestrel enforces it) so a typical 100 KB upload doesn't take 1 MB.
        var data = new byte[Math.Min(Request.ContentLength ?? MaxImageBytes, MaxImageBytes) + 1];
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

        if (!data.AsSpan(0, length).StartsWith((ReadOnlySpan<byte>)[0xFF, 0xD8, 0xFF]))
        {
            return BadRequest("Not a JPEG image.");
        }

        Directory.CreateDirectory(_folder);
        if (Pictures().Count() >= MaxImages)
        {
            return Conflict("The gallery is full. Remove pictures in the plugin's settings.");
        }

        var id = Guid.NewGuid();
        var path = PathOf(id);
        try
        {
            await System.IO.File.WriteAllBytesAsync(path + ".tmp", data.AsMemory(0, length), HttpContext.RequestAborted).ConfigureAwait(false);
            System.IO.File.Move(path + ".tmp", path);
        }
        finally
        {
            // An aborted upload must not leave files behind that the 200-picture cap doesn't count.
            System.IO.File.Delete(path + ".tmp");
        }

        return Ok(new { Id = id.ToString("N") });
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
        var path = PathOf(id);
        if (!System.IO.File.Exists(path))
        {
            return NotFound();
        }

        System.IO.File.Delete(path);
        return NoContent();
    }

    // The ID is a parsed GUID, so the path can't leave the folder.
    private string PathOf(Guid id) => Path.Combine(_folder, id.ToString("N") + ".jpg");

    private IEnumerable<string> Pictures()
        => Directory.Exists(_folder)
            ? Directory.EnumerateFiles(_folder, "*.jpg").Where(path => Guid.TryParseExact(Path.GetFileNameWithoutExtension(path), "N", out _))
            : [];

    // The same rule Jellyfin applies to changing your own profile picture. The role and claim names
    // are Jellyfin.Api's UserRoles.Administrator and InternalClaimTypes.UserId.
    private bool MayManageOwnPreferences()
        => User.IsInRole("Administrator")
            || (Guid.TryParse(User.FindFirst("Jellyfin-UserId")?.Value, out var userId)
                && _userManager.GetUserById(userId) is { EnableUserPreferenceAccess: true });

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
