// SPDX-License-Identifier: GPL-3.0-only

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
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
/// by a server-made GUID in plugins/configurations/WhoIsWatching/images/&lt;uploader's user ID&gt;, so no
/// client-supplied name ever reaches the file system, and each uploader's share can be capped.
/// Choosing a picture copies it to the user through Jellyfin's own user-image API, which applies
/// Jellyfin's permission checks; deleting one here leaves those copies.
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
    private const int MaxImagesPerUser = 20; // administrators: only the gallery's cap

    // The picker sends at most 512 × 512. A small file can declare a huge picture that every viewer's
    // browser would have to decode (gigabytes of memory for a 1 MB "decompression bomb"), so the
    // declared size is checked too.
    private const int MaxImageSide = 1024;

    // Counting and adding happen under one lock, so parallel uploads can't overshoot the caps.
    private static readonly SemaphoreSlim AddLock = new(1, 1);

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
    /// Gets the brand text settings, validated. Anonymous: the picker also covers the sign-in page,
    /// and the brand text is shown there to anyone anyway.
    /// </summary>
    /// <returns>The settings.</returns>
    [HttpGet("Settings")]
    [AllowAnonymous]
    public BrandSettings GetSettings()
    {
        var config = Plugin.Instance?.Configuration ?? new PluginConfiguration();
        var text = (config.BrandText ?? string.Empty).ReplaceLineEndings(" ").Trim(); // one line in the corner
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
        var path = Find(id);
        if (path is null)
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

        // Start and end markers and a plausible size: a whole JPEG, as the picker's canvas makes, not a stub.
        var body = data.AsSpan(0, length);
        if (length < 100 || !body.StartsWith((ReadOnlySpan<byte>)[0xFF, 0xD8, 0xFF]) || !body.EndsWith((ReadOnlySpan<byte>)[0xFF, 0xD9]))
        {
            return BadRequest("Not a JPEG image.");
        }

        if (JpegSize(body) is not (> 0 and <= MaxImageSide, > 0 and <= MaxImageSide))
        {
            return BadRequest($"Not a JPEG image of at most {MaxImageSide} × {MaxImageSide} pixels.");
        }

        await AddLock.WaitAsync(HttpContext.RequestAborted).ConfigureAwait(false);
        try
        {
            return await Add(data.AsMemory(0, length)).ConfigureAwait(false);
        }
        finally
        {
            AddLock.Release();
        }
    }

    private async Task<ActionResult> Add(ReadOnlyMemory<byte> picture)
    {
        if (Pictures().Count() >= MaxImages)
        {
            return Conflict("The gallery is full. Remove pictures in the plugin's settings.");
        }

        // One person can't fill the gallery for everyone. MayManageOwnPreferences found the user ID.
        var folder = Path.Combine(_folder, CallerId()!.Value.ToString("N"));
        if (!User.IsInRole("Administrator") && Directory.Exists(folder) && Directory.EnumerateFiles(folder, "*.jpg").Count() >= MaxImagesPerUser)
        {
            return Conflict($"You have added {MaxImagesPerUser} pictures, the most one person may add.");
        }

        Directory.CreateDirectory(folder);
        var id = Guid.NewGuid();
        var path = Path.Combine(folder, id.ToString("N") + ".jpg");
        try
        {
            await System.IO.File.WriteAllBytesAsync(path + ".tmp", picture, HttpContext.RequestAborted).ConfigureAwait(false);
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
        var path = Find(id);
        if (path is null)
        {
            return NotFound();
        }

        System.IO.File.Delete(path);
        return NoContent();
    }

    // The ID is a parsed GUID, so the name can't leave the folder. Pictures from before 1.4 sit at the top.
    private string? Find(Guid id)
        => Directory.Exists(_folder)
            ? Directory.EnumerateFiles(_folder, id.ToString("N") + ".jpg", SearchOption.AllDirectories).FirstOrDefault()
            : null;

    private IEnumerable<string> Pictures()
        => Directory.Exists(_folder)
            ? Directory.EnumerateFiles(_folder, "*.jpg", SearchOption.AllDirectories).Where(path => Guid.TryParseExact(Path.GetFileNameWithoutExtension(path), "N", out _))
            : [];

    // A JPEG's declared width and height, from the first frame header (SOFn) before the image data,
    // or null if there is none. Segments are skipped whole, so a thumbnail inside EXIF isn't read.
    private static (int Width, int Height)? JpegSize(ReadOnlySpan<byte> jpeg)
    {
        var i = 2; // after the start-of-image marker
        while (i + 9 <= jpeg.Length && jpeg[i] == 0xFF)
        {
            var marker = jpeg[i + 1];
            if (marker == 0xFF)
            {
                i++; // fill byte
                continue;
            }

            if (marker is >= 0xC0 and <= 0xCF and not 0xC4 and not 0xC8 and not 0xCC)
            {
                return ((jpeg[i + 7] << 8) | jpeg[i + 8], (jpeg[i + 5] << 8) | jpeg[i + 6]);
            }

            var segment = (jpeg[i + 2] << 8) | jpeg[i + 3];
            if (marker == 0xDA || segment < 2)
            {
                return null; // image data before any frame header, or a broken segment
            }

            i += 2 + segment;
        }

        return null;
    }

    private Guid? CallerId()
        => Guid.TryParse(User.FindFirst("Jellyfin-UserId")?.Value, out var userId) ? userId : null;

    // The same rule Jellyfin applies to changing your own profile picture. The role and claim names
    // are Jellyfin.Api's UserRoles.Administrator and InternalClaimTypes.UserId.
    private bool MayManageOwnPreferences()
        => CallerId() is { } userId
            && (User.IsInRole("Administrator") || _userManager.GetUserById(userId) is { EnableUserPreferenceAccess: true });

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
