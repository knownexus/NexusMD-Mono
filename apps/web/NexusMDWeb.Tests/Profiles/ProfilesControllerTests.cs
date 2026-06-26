using System.Net;
using System.Text;
using System.Text.Json;
using NexusMDWeb.Tests.Infrastructure;
using Xunit;

namespace NexusMDWeb.Tests.Profiles;

public class ProfilesControllerTests : IClassFixture<TestFactory>
{
    private readonly TestFactory _factory;
    public ProfilesControllerTests(TestFactory factory) => _factory = factory;

    private HttpClient NewClient() => _factory.CreateClient();

    private static StringContent Json(object obj) =>
        new(JsonSerializer.Serialize(obj), Encoding.UTF8, "application/json");

    [Fact]
    public async Task GET_profiles_returns_200_empty_list()
    {
        var client = NewClient();
        var res = await client.GetAsync("/api/profiles");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
        Assert.Equal(JsonValueKind.Array, doc.RootElement.ValueKind);
    }

    [Fact]
    public async Task POST_profiles_creates_profile_and_returns_201()
    {
        var client = NewClient();
        var res = await client.PostAsync("/api/profiles", Json(new { name = "Work", initials = "WK", color = "#9a7e22", type = "ado" }));
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
        Assert.Equal("Work", doc.RootElement.GetProperty("Name").GetString());
        Assert.Equal("ado",  doc.RootElement.GetProperty("Type").GetString());
        Assert.True(doc.RootElement.TryGetProperty("Id", out _));
    }

    [Fact]
    public async Task POST_profiles_returns_400_without_name()
    {
        var client = NewClient();
        var res = await client.PostAsync("/api/profiles", Json(new { initials = "WK", color = "#0", type = "ado" }));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task POST_profiles_returns_400_for_invalid_type()
    {
        var client = NewClient();
        var res = await client.PostAsync("/api/profiles", Json(new { name = "Work", initials = "WK", color = "#0", type = "jira" }));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task PUT_profiles_id_updates_profile()
    {
        var client = NewClient();
        var createRes = await client.PostAsync("/api/profiles", Json(new { name = "Old", initials = "OL", color = "#0", type = "ado" }));
        var created = JsonDocument.Parse(await createRes.Content.ReadAsStringAsync());
        var id = created.RootElement.GetProperty("Id").GetString();

        var updateRes = await client.PutAsync($"/api/profiles/{id}", Json(new { name = "New" }));
        Assert.Equal(HttpStatusCode.OK, updateRes.StatusCode);
        var updated = JsonDocument.Parse(await updateRes.Content.ReadAsStringAsync());
        Assert.Equal("New", updated.RootElement.GetProperty("Name").GetString());
    }

    [Fact]
    public async Task DELETE_profiles_id_removes_profile()
    {
        var client = NewClient();
        // Create two (cannot delete only profile)
        await client.PostAsync("/api/profiles", Json(new { name = "A", initials = "AA", color = "#0", type = "ado" }));
        var createRes = await client.PostAsync("/api/profiles", Json(new { name = "B", initials = "BB", color = "#0", type = "ado" }));
        var id = JsonDocument.Parse(await createRes.Content.ReadAsStringAsync()).RootElement.GetProperty("Id").GetString();

        var deleteRes = await client.DeleteAsync($"/api/profiles/{id}");
        Assert.Equal(HttpStatusCode.NoContent, deleteRes.StatusCode);
    }

    [Fact]
    public async Task DELETE_last_profile_returns_400()
    {
        var client = NewClient();
        // Use a fresh factory to isolate this test
        using var factory2 = new TestFactory();
        var client2 = factory2.CreateClient();
        var createRes = await client2.PostAsync("/api/profiles", Json(new { name = "Only", initials = "ON", color = "#0", type = "ado" }));
        var id = JsonDocument.Parse(await createRes.Content.ReadAsStringAsync()).RootElement.GetProperty("Id").GetString();
        var deleteRes = await client2.DeleteAsync($"/api/profiles/{id}");
        Assert.Equal(HttpStatusCode.BadRequest, deleteRes.StatusCode);
    }

    [Fact]
    public async Task POST_profiles_id_activate_returns_profile_with_config()
    {
        var client = NewClient();
        var config = """{"org":"myco","pat":"secret"}""";
        var createRes = await client.PostAsync("/api/profiles", Json(new { name = "Work", initials = "WK", color = "#0", type = "ado", config }));
        var id = JsonDocument.Parse(await createRes.Content.ReadAsStringAsync()).RootElement.GetProperty("Id").GetString();

        var activateRes = await client.PostAsync($"/api/profiles/{id}/activate", null);
        Assert.Equal(HttpStatusCode.OK, activateRes.StatusCode);
        var body = JsonDocument.Parse(await activateRes.Content.ReadAsStringAsync());
        Assert.Equal(config, body.RootElement.GetProperty("Config").GetString());
    }

    [Fact]
    public async Task GET_profiles_active_returns_active_profile()
    {
        var client = NewClient();
        await client.PostAsync("/api/profiles", Json(new { name = "Only", initials = "ON", color = "#0", type = "ado" }));
        var res = await client.GetAsync("/api/profiles/active");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
        Assert.True(body.RootElement.TryGetProperty("activeId", out var activeId));
        Assert.NotEqual(JsonValueKind.Null, activeId.ValueKind);
    }
}