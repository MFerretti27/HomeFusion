using System.Text;
using Jellyfin.Plugin.HomeFusion.Hosting;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace HomeFusion.Tests;

public sealed class StartupFilterTests
{
    [Theory]
    [InlineData("/web/index.html", "../HomeFusion/Client.js")]
    [InlineData("/jellyfin/web/index.html", "../HomeFusion/Client.js")]
    [InlineData("/", "HomeFusion/Client.js")]
    [InlineData("/index.html", "HomeFusion/Client.js")]
    public async Task InjectsClientScriptIntoLegacyWebHtml(string path, string scriptUrl)
    {
        var responseBody = await InvokeFilter(path, "text/html; charset=utf-8", "<html><head></head><body>Home</body></html>");
        var html = Encoding.UTF8.GetString(responseBody);

        Assert.Contains($"<script defer src=\"{scriptUrl}\"></script>", html);
        Assert.Contains("</head>", html);
    }

    [Fact]
    public async Task DoesNotInjectMoreThanOnce()
    {
        const string html = "<html><head><!-- HOMEFUSION-INJECTED --><script defer src=\"../HomeFusion/Client.js\"></script></head></html>";
        var responseBody = await InvokeFilter("/web/index.html", "text/html", html);

        Assert.Equal(html, Encoding.UTF8.GetString(responseBody));
    }

    [Fact]
    public async Task LeavesNonHtmlResponsesUnchanged()
    {
        const string body = "not html";
        var responseBody = await InvokeFilter("/web/index.html", "application/json", body);

        Assert.Equal(body, Encoding.UTF8.GetString(responseBody));
    }

    private static async Task<byte[]> InvokeFilter(string path, string contentType, string body)
    {
        using var services = new ServiceCollection().BuildServiceProvider();
        var app = new ApplicationBuilder(services);
        var filter = new HomeFusionStartupFilter();
        filter.Configure(next => next.Run(async context =>
        {
            context.Response.StatusCode = StatusCodes.Status200OK;
            context.Response.ContentType = contentType;
            await context.Response.WriteAsync(body);
        }))(app);

        var context = new DefaultHttpContext();
        context.Request.Method = HttpMethods.Get;
        context.Request.Path = path;
        context.Response.Body = new MemoryStream();
        var pipeline = app.Build();
        await pipeline(context);
        return ((MemoryStream)context.Response.Body).ToArray();
    }
}
