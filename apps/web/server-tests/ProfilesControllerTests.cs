using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using NexusMDWeb.Tests.Infrastructure;
using Xunit;

namespace NexusMDWeb.Tests;

/// <summary>
/// Covers /api/profiles — the registry the frontend's first-run setup + profile
/// switcher depend on. Regression guard for "Unexpected end of JSON input when
/// creating manual account" (the endpoint used to 404 with an empty body).
/// Each test uses a fresh factory (isolated SQLite db) so they're order-independent.
/// </summary>
public class ProfilesControllerTests
{
    private static async Task<JsonElement> ReadJson(HttpResponseMessage res)
        => JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement;

    [Fact]
    public async Task Post_creates_a_manual_profile_and_returns_it()
    {
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        var res = await client.PostAsJsonAsync("/api/profiles",
            new { name = "Solo", initials = "SO", color = "#9a7e22", type = "manual", config = (string?)null });

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var p = await ReadJson(res);
        Assert.False(string.IsNullOrWhiteSpace(p.GetProperty("id").GetString()));
        Assert.Equal("Solo", p.GetProperty("name").GetString());
        Assert.Equal("manual", p.GetProperty("type").GetString());
    }

    [Fact]
    public async Task Active_lists_created_profiles_and_first_is_active()
    {
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        var created = await ReadJson(await client.PostAsJsonAsync("/api/profiles",
            new { name = "Work", initials = "WK", color = "#000", type = "manual" }));
        var id = created.GetProperty("id").GetString();

        var state = await ReadJson(await client.GetAsync("/api/profiles/active"));
        Assert.Equal(id, state.GetProperty("activeId").GetString());
        var names = state.GetProperty("profiles").EnumerateArray().Select(e => e.GetProperty("name").GetString());
        Assert.Contains("Work", names);
    }

    [Fact]
    public async Task Activate_switches_the_active_profile()
    {
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        var a = (await ReadJson(await client.PostAsJsonAsync("/api/profiles",
            new { name = "A", initials = "A", type = "manual" }))).GetProperty("id").GetString();
        var b = (await ReadJson(await client.PostAsJsonAsync("/api/profiles",
            new { name = "B", initials = "B", type = "manual" }))).GetProperty("id").GetString();

        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync($"/api/profiles/{b}/activate", null)).StatusCode);
        var state = await ReadJson(await client.GetAsync("/api/profiles/active"));
        Assert.Equal(b, state.GetProperty("activeId").GetString());
        Assert.NotEqual(a, state.GetProperty("activeId").GetString());
    }

    [Fact]
    public async Task Delete_is_rejected_when_only_one_profile_remains()
    {
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        var id = (await ReadJson(await client.PostAsJsonAsync("/api/profiles",
            new { name = "Only", initials = "ON", type = "manual" }))).GetProperty("id").GetString();

        var res = await client.DeleteAsync($"/api/profiles/{id}");
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Delete_removes_a_profile_when_more_than_one_exists()
    {
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        await client.PostAsJsonAsync("/api/profiles", new { name = "Keep", initials = "KP", type = "manual" });
        var doomed = (await ReadJson(await client.PostAsJsonAsync("/api/profiles",
            new { name = "Doomed", initials = "DM", type = "manual" }))).GetProperty("id").GetString();

        Assert.Equal(HttpStatusCode.OK, (await client.DeleteAsync($"/api/profiles/{doomed}")).StatusCode);
        var state = await ReadJson(await client.GetAsync("/api/profiles/active"));
        var names = state.GetProperty("profiles").EnumerateArray().Select(e => e.GetProperty("name").GetString());
        Assert.DoesNotContain("Doomed", names);
        Assert.Contains("Keep", names);
    }

    [Fact]
    public async Task Import_upserts_by_id_and_sets_active()
    {
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        // Seed one profile that the import will overwrite by id.
        var seeded = await ReadJson(await client.PostAsJsonAsync("/api/profiles",
            new { name = "Old", initials = "OL", type = "manual" }));
        var existingId = seeded.GetProperty("id").GetString();

        var body = new
        {
            profiles = new[]
            {
                new { id = existingId, name = "Renamed", initials = "RN", color = "#123", type = "manual", config = (string?)null, createdAt = 1L },
                new { id = (string?)"imported-2", name = "Brand New", initials = "BN", color = "#456", type = "ado", config = (string?)"{\"org\":\"x\"}", createdAt = 2L },
            },
            activeId = "imported-2",
        };
        var res = await client.PostAsJsonAsync("/api/profiles/import", body);
        Assert.Equal(System.Net.HttpStatusCode.OK, res.StatusCode);

        var state = await ReadJson(await client.GetAsync("/api/profiles/active"));
        Assert.Equal("imported-2", state.GetProperty("activeId").GetString());
        var names = state.GetProperty("profiles").EnumerateArray().Select(e => e.GetProperty("name").GetString()).ToList();
        Assert.Contains("Renamed", names);     // overwritten by id
        Assert.Contains("Brand New", names);   // added
        Assert.DoesNotContain("Old", names);   // replaced, not duplicated
    }
}
