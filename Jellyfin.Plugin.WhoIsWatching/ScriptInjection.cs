// SPDX-License-Identifier: GPL-3.0-only

using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Net.Http.Headers;

namespace Jellyfin.Plugin.WhoIsWatching;

/// <summary>
/// Puts <see cref="ScriptInjectionMiddleware"/> in front of Jellyfin's own pipeline.
/// </summary>
public sealed class ScriptInjectionStartupFilter : IStartupFilter
{
    /// <inheritdoc />
    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next)
        => app =>
        {
            app.UseMiddleware<ScriptInjectionMiddleware>();
            next(app);
        };
}

/// <summary>
/// Adds the client script tag to Jellyfin Web's index.html as it is served. The file on disk is
/// never modified, so this also works with read-only installs (Docker, packages).
/// Every other request passes straight through after a path check.
/// </summary>
public sealed class ScriptInjectionMiddleware
{
    // Relative to ".../web/", so it resolves correctly under any BaseUrl or reverse-proxy prefix.
    private static readonly byte[] ScriptTag = Encoding.UTF8.GetBytes(
        $"<script defer src=\"../WhoIsWatching/client.js?v={typeof(Plugin).Assembly.GetName().Version}\"></script>");

    private readonly RequestDelegate _next;

    /// <summary>
    /// Initializes a new instance of the <see cref="ScriptInjectionMiddleware"/> class.
    /// </summary>
    /// <param name="next">The next middleware.</param>
    public ScriptInjectionMiddleware(RequestDelegate next) => _next = next;

    /// <summary>
    /// Handles a request.
    /// </summary>
    /// <param name="context">The HTTP context.</param>
    /// <returns>A task.</returns>
    public async Task InvokeAsync(HttpContext context)
    {
        if (!IsWebIndex(context.Request))
        {
            await _next(context).ConfigureAwait(false);
            return;
        }

        // Ask the static file handler for the full, uncompressed file so it can be edited,
        // and never let the browser revalidate against the unmodified file's ETag.
        var headers = context.Request.Headers;
        headers.Remove(HeaderNames.AcceptEncoding);
        headers.Remove(HeaderNames.IfNoneMatch);
        headers.Remove(HeaderNames.IfModifiedSince);
        headers.Remove(HeaderNames.IfRange);
        headers.Remove(HeaderNames.Range);

        var response = context.Response;
        var body = response.Body;
        using var buffer = new MemoryStream();
        response.Body = buffer;
        try
        {
            await _next(context).ConfigureAwait(false);
        }
        finally
        {
            response.Body = body;
        }

        var content = buffer.GetBuffer().AsMemory(0, (int)buffer.Length);
        if (response.StatusCode != StatusCodes.Status200OK
            || response.ContentType?.StartsWith("text/html", StringComparison.OrdinalIgnoreCase) != true)
        {
            await body.WriteAsync(content, context.RequestAborted).ConfigureAwait(false);
            return;
        }

        var at = content.Span.LastIndexOf("</body>"u8);
        if (at < 0)
        {
            at = content.Length; // A trailing script is still parsed into <body>.
        }

        response.Headers.Remove(HeaderNames.ETag);
        response.Headers.Remove(HeaderNames.LastModified);
        response.ContentLength = content.Length + ScriptTag.Length;
        await body.WriteAsync(content[..at], context.RequestAborted).ConfigureAwait(false);
        await body.WriteAsync(ScriptTag, context.RequestAborted).ConfigureAwait(false);
        await body.WriteAsync(content[at..], context.RequestAborted).ConfigureAwait(false);
    }

    private static bool IsWebIndex(HttpRequest request)
    {
        if (!HttpMethods.IsGet(request.Method))
        {
            return false;
        }

        // This runs before Jellyfin's BaseUrl mapping, so Path is the full request path.
        var path = request.Path.Value;
        return path is not null
            && (path.EndsWith("/web/", StringComparison.OrdinalIgnoreCase)
                || path.EndsWith("/web/index.html", StringComparison.OrdinalIgnoreCase));
    }
}
