using System.Net;
using System.Text;
using System.Text.Json;
using NexusMDWeb.Tests.Infrastructure;
using Xunit;

namespace NexusMDWeb.Tests.Security;

/// <summary>
/// Pins the exact Azure DevOps REST endpoints that each write controller is
/// permitted to call.
///
/// For every write action this verifies:
///   1. Exactly ONE outbound ADO request is made — no hidden side-channel calls.
///   2. The HTTP method matches the expected verb (PUT/POST/PATCH).
///   3. The URL path matches the expected pattern — preventing scope creep.
///   4. The request body contains exactly what ADO expects (no leaking extra fields).
///
/// Any deviation from these assertions means the controller has changed which
/// ADO APIs it calls, and the change must be reviewed intentionally.
/// </summary>
public class WriteEndpointScopeTests
{
    private const string Project = TestFactory.TestProject;
    private const string RepoId  = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    private const int    PrId    = 42;
    private const int    WiId    = 99;
    private const string UserId  = "ffffffff-0000-1111-2222-333333333333";

    // ── PR Vote ───────────────────────────────────────────────────────────────

    [Fact]
    public async Task VotePR_makes_exactly_one_PUT_to_the_reviewers_endpoint()
    {
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        var body = JsonSerializer.Serialize(new { vote = 10, userId = UserId });
        await client.PutAsync(
            $"/api/pullrequests/{Project}/{RepoId}/{PrId}/vote",
            new StringContent(body, Encoding.UTF8, "application/json"));

        var calls = factory.FakeHandler.Calls;
        Assert.Single(calls);
        Assert.Equal(HttpMethod.Put, calls[0].Method);
        Assert.Matches(
            @"/_apis/git/repositories/[^/]+/pullRequests/\d+/reviewers/[^/?]+",
            calls[0].RequestUri.AbsolutePath);
    }

    [Fact]
    public async Task VotePR_sends_only_the_vote_value_in_the_body_not_the_userId()
    {
        // userId belongs in the URL (as the reviewer identifier), not in the JSON body
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        var body = JsonSerializer.Serialize(new { vote = 10, userId = UserId });
        await client.PutAsync(
            $"/api/pullrequests/{Project}/{RepoId}/{PrId}/vote",
            new StringContent(body, Encoding.UTF8, "application/json"));

        var requestBody = factory.FakeHandler.Calls[0].RequestBody!;
        Assert.Contains("\"vote\"", requestBody);
        Assert.DoesNotContain("userId", requestBody, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(10,  "Approved")]
    [InlineData(5,   "Approved with suggestions")]
    [InlineData(0,   "Vote reset")]
    [InlineData(-5,  "Waiting for author")]
    [InlineData(-10, "Rejected")]
    public async Task VotePR_accepts_all_valid_vote_values(int vote, string _)
    {
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        var body = JsonSerializer.Serialize(new { vote, userId = UserId });
        var response = await client.PutAsync(
            $"/api/pullrequests/{Project}/{RepoId}/{PrId}/vote",
            new StringContent(body, Encoding.UTF8, "application/json"));

        // Should reach ADO (200 from fake) — not blocked by our own validation
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Single(factory.FakeHandler.Calls);
    }

    [Fact]
    public async Task VotePR_without_userId_is_rejected_before_reaching_ADO()
    {
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        var body = JsonSerializer.Serialize(new { vote = 10, userId = "" });
        var response = await client.PutAsync(
            $"/api/pullrequests/{Project}/{RepoId}/{PrId}/vote",
            new StringContent(body, Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(factory.FakeHandler.Calls); // Nothing forwarded to ADO
    }

    // ── PR Comment ────────────────────────────────────────────────────────────

    [Fact]
    public async Task CommentPR_makes_exactly_one_POST_to_the_threads_endpoint()
    {
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        var body = JsonSerializer.Serialize(new { content = "Looks good to me!" });
        await client.PostAsync(
            $"/api/pullrequests/{Project}/{RepoId}/{PrId}/threads",
            new StringContent(body, Encoding.UTF8, "application/json"));

        var calls = factory.FakeHandler.Calls;
        Assert.Single(calls);
        Assert.Equal(HttpMethod.Post, calls[0].Method);
        Assert.Matches(
            @"/_apis/git/repositories/[^/]+/pullRequests/\d+/threads",
            calls[0].RequestUri.AbsolutePath);
    }

    [Fact]
    public async Task CommentPR_with_empty_content_is_rejected_before_reaching_ADO()
    {
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        var body = JsonSerializer.Serialize(new { content = "  " });
        var response = await client.PostAsync(
            $"/api/pullrequests/{Project}/{RepoId}/{PrId}/threads",
            new StringContent(body, Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(factory.FakeHandler.Calls);
    }

    // ── PR Abandon ────────────────────────────────────────────────────────────

    [Fact]
    public async Task AbandonPR_makes_exactly_one_PATCH_to_the_pullRequests_endpoint()
    {
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        var body = JsonSerializer.Serialize(new { status = "abandoned" });
        await client.PatchAsync(
            $"/api/pullrequests/{Project}/{RepoId}/{PrId}",
            new StringContent(body, Encoding.UTF8, "application/json"));

        var calls = factory.FakeHandler.Calls;
        Assert.Single(calls);
        Assert.Equal(HttpMethod.Patch, calls[0].Method);
        Assert.Matches(
            @"/_apis/git/repositories/[^/]+/pullRequests/\d+",
            calls[0].RequestUri.AbsolutePath);
    }

    // ── PR Complete ───────────────────────────────────────────────────────────

    [Fact]
    public async Task CompletePR_makes_exactly_one_PATCH_to_the_pullRequests_endpoint()
    {
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        var body = JsonSerializer.Serialize(new
        {
            status                = "completed",
            lastMergeSourceCommit = "abc1234def5678",
            mergeStrategy         = "squash",
            deleteSourceBranch    = true,
        });

        await client.PatchAsync(
            $"/api/pullrequests/{Project}/{RepoId}/{PrId}",
            new StringContent(body, Encoding.UTF8, "application/json"));

        var calls = factory.FakeHandler.Calls;
        Assert.Single(calls);
        Assert.Equal(HttpMethod.Patch, calls[0].Method);
        Assert.Matches(
            @"/_apis/git/repositories/[^/]+/pullRequests/\d+",
            calls[0].RequestUri.AbsolutePath);
    }

    [Fact]
    public async Task CompletePR_without_lastMergeSourceCommit_is_rejected_before_reaching_ADO()
    {
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        var body = JsonSerializer.Serialize(new { status = "completed" });
        var response = await client.PatchAsync(
            $"/api/pullrequests/{Project}/{RepoId}/{PrId}",
            new StringContent(body, Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(factory.FakeHandler.Calls);
    }

    [Theory]
    [InlineData("deleted")]
    [InlineData("merged")]
    [InlineData("approved")]
    [InlineData("open")]
    public async Task UpdatePR_with_invalid_status_is_rejected_before_reaching_ADO(string status)
    {
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        var body = JsonSerializer.Serialize(new { status });
        var response = await client.PatchAsync(
            $"/api/pullrequests/{Project}/{RepoId}/{PrId}",
            new StringContent(body, Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(factory.FakeHandler.Calls);
    }

    // ── Work Item Create ──────────────────────────────────────────────────────

    [Fact]
    public async Task CreateWorkItem_makes_exactly_one_POST_to_the_workitems_type_endpoint()
    {
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        var body = JsonSerializer.Serialize(new
        {
            project = Project,
            type    = "Bug",
            fields  = new Dictionary<string, string> { ["System.Title"] = "Something is broken" },
        });

        await client.PostAsync(
            "/api/workitems",
            new StringContent(body, Encoding.UTF8, "application/json"));

        var calls = factory.FakeHandler.Calls;
        Assert.Single(calls);
        Assert.Equal(HttpMethod.Post, calls[0].Method);

        // Path must be /{project}/_apis/wit/workitems/${WorkItemType}
        Assert.Matches(
            @"/_apis/wit/workitems/\$[^/?]+",
            calls[0].RequestUri.AbsolutePath);
    }

    [Fact]
    public async Task CreateWorkItem_body_sent_to_ADO_uses_json_patch_format()
    {
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        var body = JsonSerializer.Serialize(new
        {
            project = Project,
            type    = "Task",
            fields  = new Dictionary<string, string> { ["System.Title"] = "My task" },
        });

        await client.PostAsync(
            "/api/workitems",
            new StringContent(body, Encoding.UTF8, "application/json"));

        var requestBody = factory.FakeHandler.Calls[0].RequestBody!;

        // ADO work item creation requires JSON-Patch format: [{op, path, value}]
        Assert.Contains("\"op\"",    requestBody);
        Assert.Contains("\"path\"",  requestBody);
        Assert.Contains("\"value\"", requestBody);
        Assert.Contains("/fields/",  requestBody);
    }

    [Fact]
    public async Task CreateWorkItem_without_title_is_rejected_before_reaching_ADO()
    {
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        var body = JsonSerializer.Serialize(new
        {
            project = Project,
            type    = "Bug",
            fields  = new Dictionary<string, string>(), // No System.Title
        });

        var response = await client.PostAsync(
            "/api/workitems",
            new StringContent(body, Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(factory.FakeHandler.Calls);
    }

    [Fact]
    public async Task CreateWorkItem_without_project_is_rejected_before_reaching_ADO()
    {
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        var body = JsonSerializer.Serialize(new
        {
            project = "",
            type    = "Bug",
            fields  = new Dictionary<string, string> { ["System.Title"] = "Test" },
        });

        var response = await client.PostAsync(
            "/api/workitems",
            new StringContent(body, Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(factory.FakeHandler.Calls);
    }

    // ── Work Item Update ──────────────────────────────────────────────────────

    [Fact]
    public async Task UpdateWorkItem_makes_exactly_one_PATCH_to_the_workitems_id_endpoint()
    {
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        var ops = JsonSerializer.Serialize(new[]
        {
            new { op = "add", path = "/fields/System.State", value = "Active" },
        });

        await client.PatchAsync(
            $"/api/workitems/{WiId}",
            new StringContent(ops, Encoding.UTF8, "application/json"));

        var calls = factory.FakeHandler.Calls;
        Assert.Single(calls);
        Assert.Equal(HttpMethod.Patch, calls[0].Method);

        // Must target the specific work item ID, not a wildcard path
        Assert.EndsWith($"/{WiId}", calls[0].RequestUri.AbsolutePath.TrimEnd('/'));
        Assert.Matches(
            @"/_apis/wit/workitems/\d+",
            calls[0].RequestUri.AbsolutePath);
    }

    [Fact]
    public async Task UpdateWorkItem_with_empty_ops_array_is_rejected_before_reaching_ADO()
    {
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        var response = await client.PatchAsync(
            $"/api/workitems/{WiId}",
            new StringContent("[]", Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(factory.FakeHandler.Calls);
    }

    // ── Cross-cutting: write actions always target dev.azure.com ─────────────

    [Fact]
    public async Task All_write_actions_target_dev_azure_com_not_an_arbitrary_host()
    {
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        // Exercise all four write endpoints
        await client.PutAsync(
            $"/api/pullrequests/{Project}/{RepoId}/{PrId}/vote",
            Json(new { vote = 10, userId = UserId }));

        await client.PostAsync(
            $"/api/pullrequests/{Project}/{RepoId}/{PrId}/threads",
            Json(new { content = "comment" }));

        await client.PatchAsync(
            $"/api/pullrequests/{Project}/{RepoId}/{PrId}",
            Json(new { status = "abandoned" }));

        await client.PostAsync(
            "/api/workitems",
            Json(new { project = Project, type = "Bug", fields = new { } }));

        await client.PatchAsync(
            $"/api/workitems/{WiId}",
            Json(new[] { new { op = "add", path = "/fields/System.State", value = "Active" } }));

        foreach (var call in factory.FakeHandler.Calls)
        {
            Assert.Equal("dev.azure.com", call.RequestUri.Host);
        }
    }

    private static StringContent Json(object obj)
        => new(JsonSerializer.Serialize(obj), Encoding.UTF8, "application/json");
}