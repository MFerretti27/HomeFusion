using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Primitives;

namespace Jellyfin.Plugin.HomeFusion.Hosting;

public sealed class HomeFusionStartupFilter : IStartupFilter
{
    private const string InjectionMarker = "<!-- HOMEFUSION-INJECTED -->";
    private const string ScriptPath = "HomeFusion/Client.js";

    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next)
    {
        return app =>
        {
            app.Use(async (context, nextMiddleware) =>
            {
                if (!HttpMethods.IsGet(context.Request.Method) || !IsIndexRequest(context.Request.Path))
                {
                    await nextMiddleware();
                    return;
                }

                var originalAcceptEncoding = context.Request.Headers.AcceptEncoding;
                var originalBody = context.Response.Body;
                await using var buffer = new MemoryStream();
                context.Request.Headers.AcceptEncoding = "identity";
                context.Response.Body = buffer;

                try
                {
                    await nextMiddleware();
                    buffer.Position = 0;

                    if (context.Response.StatusCode != StatusCodes.Status200OK
                        || !(context.Response.ContentType?.StartsWith("text/html", StringComparison.OrdinalIgnoreCase) ?? false)
                        || context.Response.Headers.ContainsKey("Content-Encoding"))
                    {
                        await buffer.CopyToAsync(originalBody, context.RequestAborted);
                        return;
                    }

                    using var reader = new StreamReader(buffer, Encoding.UTF8, detectEncodingFromByteOrderMarks: true, leaveOpen: true);
                    var html = await reader.ReadToEndAsync(context.RequestAborted);
                    var scriptUrl = GetScriptUrl(context.Request.Path);
                    var scriptTag = $"{InjectionMarker}<script defer src=\"{scriptUrl}\"></script>";
                    var headEnd = html.IndexOf("</head>", StringComparison.OrdinalIgnoreCase);
                    var bodyEnd = html.IndexOf("</body>", StringComparison.OrdinalIgnoreCase);
                    var insertAt = headEnd >= 0 ? headEnd : bodyEnd;

                    if (html.Contains(InjectionMarker, StringComparison.OrdinalIgnoreCase) || insertAt < 0)
                    {
                        buffer.Position = 0;
                        await buffer.CopyToAsync(originalBody, context.RequestAborted);
                        return;
                    }

                    html = html.Insert(insertAt, scriptTag);
                    var output = Encoding.UTF8.GetBytes(html);
                    context.Response.ContentLength = output.Length;
                    await originalBody.WriteAsync(output, context.RequestAborted);
                }
                finally
                {
                    context.Response.Body = originalBody;
                    context.Request.Headers.AcceptEncoding = originalAcceptEncoding;
                }
            });

            next(app);
        };
    }

    private static bool IsIndexRequest(PathString path)
    {
        var value = path.Value ?? string.Empty;
        return value == "/"
            || value.EndsWith("/index.html", StringComparison.OrdinalIgnoreCase)
            || value.EndsWith("/web", StringComparison.OrdinalIgnoreCase)
            || value.EndsWith("/web/", StringComparison.OrdinalIgnoreCase);
    }

    private static string GetScriptUrl(PathString path)
    {
        var value = path.Value ?? string.Empty;
        if (value.EndsWith("/web", StringComparison.OrdinalIgnoreCase))
        {
            return $"./{ScriptPath}";
        }

        return value.EndsWith("/web/", StringComparison.OrdinalIgnoreCase)
            || value.EndsWith("/web/index.html", StringComparison.OrdinalIgnoreCase)
                ? $"../{ScriptPath}"
                : ScriptPath;
    }
}
