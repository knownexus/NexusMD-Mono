using Microsoft.AspNetCore.Mvc;

namespace NexusMDWeb.Api.Services.Sync;

/// <summary>
/// Refuses sync writes from clients older than <c>Sync:MinFormat</c> (default 1 = accept everyone). Clients announce
/// their format in <c>X-Sync-Format</c>; a missing or unparsable header means format 1. Reads are never gated.
/// </summary>
public static class SyncFormatGate
{
    public const string HeaderName = "X-Sync-Format";

    public static bool IsOutdated(HttpRequest req, IConfiguration cfg)
    {
        var min = cfg.GetValue<int?>("Sync:MinFormat") ?? 1;
        var clientFormat = int.TryParse(req.Headers[HeaderName].ToString(), System.Globalization.NumberStyles.None,
            System.Globalization.CultureInfo.InvariantCulture, out var v) ? v : 1;
        return clientFormat < min;
    }

    public static IActionResult Outdated() =>
        new ObjectResult(new { error = "this client is too old to sync; update NexusMD", code = "client_outdated" })
        { StatusCode = StatusCodes.Status426UpgradeRequired };
}
