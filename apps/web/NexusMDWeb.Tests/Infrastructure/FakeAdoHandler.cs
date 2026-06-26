using System.Net;
using System.Net.Http.Headers;
using System.Text;

namespace NexusMDWeb.Tests.Infrastructure;

/// <summary>
/// Replaces the real ADO HttpClient in tests.
/// Records every outbound request so tests can assert on which URLs and HTTP
/// methods were used — without making any real network calls.
/// </summary>
public sealed class FakeAdoHandler : HttpMessageHandler
{
    /// <summary>An outbound request captured during the test.</summary>
    public sealed record Call(
        HttpMethod      Method,
        Uri             RequestUri,
        string?         RequestBody,
        HttpRequestHeaders RequestHeaders);

    private readonly List<Call> _calls = [];

    /// <summary>All outbound requests made since this handler was created.</summary>
    public IReadOnlyList<Call> Calls => _calls;

    private readonly HttpStatusCode _status;
    private readonly string         _body;

    public FakeAdoHandler(
        HttpStatusCode status = HttpStatusCode.OK,
        string         body   = """{"value":[]}""")
    {
        _status = status;
        _body   = body;
    }

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var requestBody = request.Content is not null
            ? await request.Content.ReadAsStringAsync(cancellationToken)
            : null;

        _calls.Add(new Call(
            request.Method,
            request.RequestUri!,
            requestBody,
            request.Headers));

        return new HttpResponseMessage(_status)
        {
            Content = new StringContent(_body, Encoding.UTF8, "application/json"),
        };
    }
}