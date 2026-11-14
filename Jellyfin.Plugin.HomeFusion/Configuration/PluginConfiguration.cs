using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.HomeFusion.Configuration;

public sealed class PluginConfiguration : BasePluginConfiguration
{
    public bool ShowGenres { get; set; } = true;
    public bool RandomizeGenres { get; set; }

    public string HiddenGenres { get; set; } = string.Empty;
    public string GenresPosition { get; set; } = "bottom";
    public bool ShowRatings { get; set; } = true;
    public string RatingsPosition { get; set; } = "bottom";
    public bool ShowReleaseDates { get; set; } = true;
    public string ReleaseDatesPosition { get; set; } = "bottom";
    public bool ShowCollections { get; set; }
    public bool RandomizeCollections { get; set; }
    public int MaxCollections { get; set; }
    public string CollectionsPosition { get; set; } = "bottom";
    public bool IncludeMovies { get; set; } = true;
    public bool IncludeSeries { get; set; }
    public bool HideTitleCounts { get; set; }
    public bool HideSyncPlay { get; set; }
    public bool HideCast { get; set; }
    public bool RoundedPosters { get; set; }
    public bool HideMyMediaTitle { get; set; }
    public bool HideCardSecondaryText { get; set; }
    public bool HideMyMediaCardText { get; set; }
}
