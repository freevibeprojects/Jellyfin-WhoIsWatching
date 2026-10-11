// SPDX-License-Identifier: GPL-3.0-only

using System;
using System.Collections.Generic;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.WhoIsWatching;

/// <summary>
/// "Who's watching?" profile switcher for Jellyfin Web. The server-side part injects one script tag
/// into the web client, serves that script, the brand settings and the shared picture gallery.
/// </summary>
public sealed class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    /// <summary>
    /// Initializes a new instance of the <see cref="Plugin"/> class.
    /// </summary>
    /// <param name="applicationPaths">Application paths.</param>
    /// <param name="xmlSerializer">XML serializer.</param>
    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
    }

    /// <summary>
    /// Gets the loaded plugin, for its configuration.
    /// </summary>
    public static Plugin? Instance { get; private set; }

    /// <inheritdoc />
    public override string Name => "Who's Watching";

    /// <inheritdoc />
    public override Guid Id => Guid.Parse("2d627493-2b57-432a-b238-c22aaf9fd609");

    /// <inheritdoc />
    public override string Description => "Netflix-style profile switching from the avatar button in Jellyfin Web.";

    /// <inheritdoc />
    public IEnumerable<PluginPageInfo> GetPages()
        => [new PluginPageInfo { Name = "WhoIsWatching", DisplayName = Name, EmbeddedResourcePath = "WhoIsWatching.config.html" }];
}

/// <summary>
/// Settings edited on the plugin's dashboard page. <see cref="GalleryController"/> validates them
/// before any client sees them.
/// </summary>
public sealed class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>
    /// Gets or sets the text shown in the picker's corner; empty hides it.
    /// </summary>
    public string BrandText { get; set; } = "Jellyfin";

    /// <summary>
    /// Gets or sets the text colour as #RRGGBB. The default is Jellyfin's logo purple.
    /// </summary>
    public string BrandColor { get; set; } = "#AA5CC3";

    /// <summary>
    /// Gets or sets the text size in pixels.
    /// </summary>
    public int BrandSize { get; set; } = 40;

    /// <summary>
    /// Gets or sets where the text goes: TopLeft, TopCenter or TopRight.
    /// </summary>
    public string BrandPosition { get; set; } = "TopLeft";
}

/// <summary>
/// Registers the index.html injection with the host. Jellyfin runs plugin registrators
/// before the web host is built, so the startup filter becomes part of the pipeline.
/// </summary>
public sealed class ServiceRegistrator : IPluginServiceRegistrator
{
    /// <inheritdoc />
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
        => serviceCollection.AddTransient<IStartupFilter, ScriptInjectionStartupFilter>();
}
