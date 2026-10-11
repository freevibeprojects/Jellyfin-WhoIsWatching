// SPDX-License-Identifier: GPL-3.0-only

using System.IO;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.WhoIsWatching;

/// <summary>
/// Serves the profile switcher script. It is static and contains no user data, so it is anonymous:
/// index.html loads it before anyone has signed in.
/// </summary>
[ApiController]
[Route("WhoIsWatching")]
public sealed class ClientScriptController : ControllerBase
{
    private static readonly byte[] Script = ReadScript();

    /// <summary>
    /// Gets the client script.
    /// </summary>
    /// <returns>The script.</returns>
    [HttpGet("client.js")]
    [AllowAnonymous]
    public FileContentResult GetClientScript()
    {
        // The injected URL carries the plugin version, so a cached copy is never stale.
        Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        return File(Script, "text/javascript; charset=utf-8");
    }

    private static byte[] ReadScript()
    {
        using var stream = typeof(ClientScriptController).Assembly.GetManifestResourceStream("WhoIsWatching.client.js")!;
        using var bytes = new MemoryStream();
        stream.CopyTo(bytes);
        return bytes.ToArray();
    }
}
