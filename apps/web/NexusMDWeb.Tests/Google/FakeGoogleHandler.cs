using System.Net;
using System.Text;

namespace NexusMDWeb.Tests.Google;

public sealed class FakeGoogleHandler : HttpMessageHandler
{
    public record Call(HttpMethod Method, Uri Uri, string? Body, string? AuthHeader);
    private readonly List<Call> _calls = [];
    public IReadOnlyList<Call> Calls => _calls;
    public Dictionary<string, string> Responses { get; } = new();

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage req, CancellationToken ct)
    {
        var body = req.Content is not null ? await req.Content.ReadAsStringAsync(ct) : null;
        _calls.Add(new Call(req.Method, req.RequestUri!, body, req.Headers.Authorization?.ToString()));
        var key = req.RequestUri!.PathAndQuery;
        var json = Responses.TryGetValue(key, out var r) ? r : "{}";
        return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
    }
}