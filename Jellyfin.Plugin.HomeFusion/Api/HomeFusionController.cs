using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.HomeFusion.Api;

[ApiController]
[Route("HomeFusion")]
public sealed class HomeFusionController : ControllerBase
{
    [HttpGet("Client.js")]
    [AllowAnonymous]
    [Produces("application/javascript")]
    public ActionResult GetScript()
    {
        var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("Jellyfin.Plugin.HomeFusion.Web.homefusion.js");
        return stream is null ? NotFound() : File(stream, "application/javascript");
    }

    [HttpGet("Config")]
    [Authorize]
    public ActionResult GetConfig()
    {
        var c = Plugin.Instance!.Configuration;
        return Ok(new
        {
            Rows = new[]
            {
                new { Key = "genres", Enabled = c.ShowGenres, Position = c.GenresPosition },
                new { Key = "ratings", Enabled = c.ShowRatings, Position = c.RatingsPosition },
                new { Key = "release", Enabled = c.ShowReleaseDates, Position = c.ReleaseDatesPosition },
                new { Key = "collections", Enabled = c.ShowCollections, Position = c.CollectionsPosition }
            },
            c.RandomizeGenres,
            c.RandomizeCollections,
            c.HiddenGenres,
            c.IncludeMovies,
            c.IncludeSeries,
            c.HideSyncPlay,
            c.HideCast,
            c.RoundedPosters,
            c.HideMyMediaTitle
        });
    }
}
