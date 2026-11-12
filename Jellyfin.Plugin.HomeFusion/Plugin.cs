using Jellyfin.Plugin.HomeFusion.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Jellyfin.Plugin.HomeFusion;

public sealed class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
    }

    public static Plugin? Instance { get; private set; }
    public override string Name => "HomeFusion";
    public override string Description => "Adds Genres, Ratings, Release Date and Collections rows to the home screen.";
    public override Guid Id => Guid.Parse("8c6f0a52-3b5e-4d8a-9a3e-6a1f2b7c4d10");

    public IEnumerable<PluginPageInfo> GetPages() =>
    [
        new PluginPageInfo
        {
            Name = Name,
            DisplayName = "Home Fusion",
            EmbeddedResourcePath = "Jellyfin.Plugin.HomeFusion.Configuration.configPage.html",
            EnableInMainMenu = true,
            MenuSection = "plugins",
            MenuIcon = "view_carousel"
        }
    ];
}
