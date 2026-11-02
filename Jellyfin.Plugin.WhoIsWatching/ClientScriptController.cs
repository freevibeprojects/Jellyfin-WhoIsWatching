// SPDX-License-Identifier: GPL-3.0-only

using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
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

    // Compressed once at the smallest size, rather than per request at the fastest level.
    private static readonly byte[] BrotliScript = Brotli(Script);

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
        Response.Headers.Vary = "Accept-Encoding";
        if (Request.GetTypedHeaders().AcceptEncoding.Any(e => e.Value == "br" && (e.Quality ?? 1) > 0))
        {
            Response.Headers.ContentEncoding = "br"; // Jellyfin's compression leaves an encoded response alone
            return File(BrotliScript, "text/javascript; charset=utf-8");
        }

        return File(Script, "text/javascript; charset=utf-8");
    }

    // Comment lines, blank lines and indentation are a third of the source; browsers download and parse it without them.
    // Safe because client.js's only multi-line strings are CSS and HTML, where no line starts with //.
    // The licence line stays.
    private static byte[] ReadScript()
    {
        using var stream = typeof(ClientScriptController).Assembly.GetManifestResourceStream("WhoIsWatching.client.js")!;
        using var reader = new StreamReader(stream);
        var lines = reader.ReadToEnd().ReplaceLineEndings("\n").Split('\n').Select(line => line.TrimStart());
        return Encoding.UTF8.GetBytes(string.Join('\n', lines.Take(1).Concat(lines.Skip(1).Where(line => line.Length > 0 && !line.StartsWith("//", StringComparison.Ordinal)))));
    }

    private static byte[] Brotli(byte[] data)
    {
        using var output = new MemoryStream();
        using (var brotli = new BrotliStream(output, CompressionLevel.SmallestSize))
        {
            brotli.Write(data);
        }

        return output.ToArray();
    }
}
