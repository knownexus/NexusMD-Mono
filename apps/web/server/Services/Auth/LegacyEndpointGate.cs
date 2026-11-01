namespace NexusMDWeb.Api.Services.Auth;

/// <summary>
/// Returns 404 for the legacy unauthenticated API surface (ado/config/files/profiles)
/// unless Web:LegacyEndpoints is true. OAuth endpoints are intentionally not gated.
/// </summary>
public sealed class LegacyEndpointGate
{
    private static readonly string[] GatedPrefixes =
    {
        "/api/ado", "/api/config", "/api/files", "/api/profiles",
    };

    private readonly RequestDelegate _next;
    private readonly IConfiguration _config;

    public LegacyEndpointGate(RequestDelegate next, IConfiguration config)
    {
        _next = next;
        _config = config;
    }

    public Task InvokeAsync(HttpContext context)
    {
        if (!_config.GetValue<bool>("Web:LegacyEndpoints") && IsGated(context.Request.Path))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return Task.CompletedTask;
        }
        return _next(context);
    }

    private static bool IsGated(PathString path)
    {
        foreach (var prefix in GatedPrefixes)
        {
            // StartsWithSegments matches the prefix on a segment boundary (case-insensitive),
            // so "/api/files" and "/api/files/x" match but "/api/filesystem" does not.
            if (path.StartsWithSegments(prefix, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }
}
