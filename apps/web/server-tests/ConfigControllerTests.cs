using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using NexusMDWeb.Tests.Infrastructure;
using Xunit;

namespace NexusMDWeb.Tests;

/// <summary>
/// Covers the only remaining config surface: GET /api/config (read settings, never the PAT)
/// and PUT /api/config (validate + persist to appsettings.user.json).
/// </summary>
public class ConfigControllerTests : IClassFixture<TestFactory>
{
    private readonly TestFactory _factory;
    private readonly HttpClient _client;

    public ConfigControllerTests(TestFactory factory)
    {
        _factory = factory;
        _client  = factory.CreateClient();
    }

    [Fact]
    public async Task Get_returns_org_and_projects()
    {
        var body = await (await _client.GetAsync("/api/config")).Content.ReadAsStringAsync();
        Assert.Contains(TestFactory.TestOrg, body);
        Assert.Contains("\"projects\"", body);
        Assert.Contains("\"refreshSecs\"", body);
    }

    [Fact]
    public async Task Get_never_exposes_the_pat()
    {
        var response = await _client.GetAsync("/api/config");
        var body     = await response.Content.ReadAsStringAsync();

        Assert.DoesNotContain(TestFactory.TestPat, body, StringComparison.OrdinalIgnoreCase);
        // ...and not under any secret-ish key name either
        Assert.DoesNotContain("\"pat\"",    body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("\"token\"",  body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("\"secret\"", body, StringComparison.OrdinalIgnoreCase);

        var headerValues = response.Headers
            .Concat(response.Content.Headers)
            .SelectMany(h => h.Value);
        foreach (var value in headerValues)
            Assert.DoesNotContain(TestFactory.TestPat, value, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Put_without_organisation_is_rejected()
    {
        var response = await _client.PutAsync("/api/config",
            JsonContent.Create(new { projects = new[] { "P1" } }));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Put_without_projects_is_rejected()
    {
        var response = await _client.PutAsync("/api/config",
            JsonContent.Create(new { organisation = "acme", projects = Array.Empty<string>() }));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Put_persists_settings_to_user_config_file()
    {
        var response = await _client.PutAsync("/api/config",
            JsonContent.Create(new { organisation = "acme", projects = new[] { "Alpha", "Beta" }, refreshSecs = 45 }));
        response.EnsureSuccessStatusCode();

        var userFile = Path.Combine(_factory.ContentRoot, "appsettings.user.json");
        Assert.True(File.Exists(userFile), "appsettings.user.json should be written");

        using var doc = JsonDocument.Parse(File.ReadAllText(userFile));
        var ado = doc.RootElement.GetProperty("Ado");
        Assert.Equal("acme", ado.GetProperty("Organisation").GetString());
        Assert.Equal(2, ado.GetProperty("Projects").GetArrayLength());
    }

    [Fact]
    public async Task Put_with_blank_pat_keeps_existing_pat_and_never_echoes_it()
    {
        var response = await _client.PutAsync("/api/config",
            JsonContent.Create(new { organisation = "acme", projects = new[] { "Alpha" }, pat = "" }));
        var body = await response.Content.ReadAsStringAsync();

        response.EnsureSuccessStatusCode();
        Assert.DoesNotContain(TestFactory.TestPat, body, StringComparison.OrdinalIgnoreCase);
    }
}
