using System.Net;
using System.Text;
using NexusMDWeb.Tests.Infrastructure;
using Xunit;

namespace NexusMDWeb.Tests;

/// <summary>
/// Covers the sandboxed file bridge: round-trips, listing, existence, deletion,
/// directory creation, and — critically — that path traversal cannot escape the sandbox.
/// </summary>
public class FilesControllerTests : IClassFixture<TestFactory>
{
    private readonly HttpClient _client;

    public FilesControllerTests(TestFactory factory)
    {
        _client = factory.CreateClient();
    }

    private static StringContent Text(string s) => new(s, Encoding.UTF8, "text/plain");

    [Fact]
    public async Task Default_dir_returns_a_path()
    {
        var body = await (await _client.GetAsync("/api/files/default-dir")).Content.ReadAsStringAsync();
        Assert.Contains("path", body);
        Assert.Contains("profiles", body);
    }

    [Fact]
    public async Task Write_then_read_round_trips_content()
    {
        var write = await _client.PostAsync("/api/files/content?path=p1/profile.json", Text("{\"hello\":\"world\"}"));
        write.EnsureSuccessStatusCode();

        var read = await _client.GetAsync("/api/files/content?path=p1/profile.json");
        read.EnsureSuccessStatusCode();
        Assert.Equal("{\"hello\":\"world\"}", await read.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Read_missing_file_returns_404()
    {
        var read = await _client.GetAsync("/api/files/content?path=does/not/exist.json");
        Assert.Equal(HttpStatusCode.NotFound, read.StatusCode);
    }

    [Fact]
    public async Task Exists_reflects_writes()
    {
        await _client.PostAsync("/api/files/content?path=p2/a.txt", Text("x"));

        var existing = await (await _client.GetAsync("/api/files/exists?path=p2/a.txt")).Content.ReadAsStringAsync();
        var missing  = await (await _client.GetAsync("/api/files/exists?path=p2/missing.txt")).Content.ReadAsStringAsync();

        Assert.Contains("true",  existing);
        Assert.Contains("false", missing);
    }

    [Fact]
    public async Task List_returns_written_entries()
    {
        await _client.PostAsync("/api/files/content?path=listdir/one.txt", Text("1"));
        await _client.PostAsync("/api/files/content?path=listdir/two.txt", Text("2"));

        var body = await (await _client.GetAsync("/api/files/list?dir=listdir")).Content.ReadAsStringAsync();
        Assert.Contains("one.txt", body);
        Assert.Contains("two.txt", body);
    }

    [Fact]
    public async Task Delete_removes_a_file()
    {
        await _client.PostAsync("/api/files/content?path=del/gone.txt", Text("bye"));
        (await _client.DeleteAsync("/api/files/content?path=del/gone.txt")).EnsureSuccessStatusCode();

        var read = await _client.GetAsync("/api/files/content?path=del/gone.txt");
        Assert.Equal(HttpStatusCode.NotFound, read.StatusCode);
    }

    [Fact]
    public async Task Mkdir_then_exists_is_true()
    {
        (await _client.PostAsync("/api/files/dir?path=newdir", null)).EnsureSuccessStatusCode();
        var body = await (await _client.GetAsync("/api/files/exists?path=newdir")).Content.ReadAsStringAsync();
        Assert.Contains("true", body);
    }

    [Theory]
    [InlineData("../../../escape.txt")]
    [InlineData("..%2F..%2Fescape.txt")]
    [InlineData("/etc/passwd")]
    public async Task Path_traversal_is_blocked(string evilPath)
    {
        // A traversal attempt must never read outside the sandbox: either rejected
        // as a bad path, or harmlessly resolved inside the sandbox (404).
        var read = await _client.GetAsync($"/api/files/content?path={Uri.EscapeDataString(evilPath)}");
        Assert.True(
            read.StatusCode is HttpStatusCode.BadRequest or HttpStatusCode.NotFound,
            $"Expected BadRequest or NotFound for '{evilPath}', got {read.StatusCode}");
    }

    [Fact]
    public async Task Write_traversal_cannot_escape_sandbox()
    {
        var write = await _client.PostAsync(
            $"/api/files/content?path={Uri.EscapeDataString("../../escaped.txt")}", Text("pwned"));
        Assert.Equal(HttpStatusCode.BadRequest, write.StatusCode);
    }
}
