using Microsoft.AspNetCore.Mvc;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace NexusMDWeb.Api.Controllers;

/// <summary>
/// Returns server-side configuration to the frontend (PAT is never included),
/// and allows the UI to persist new settings to appsettings.user.json.
/// </summary>
[ApiController]
[Route("api/config")]
public class ConfigController(IConfiguration config, IWebHostEnvironment env) : ControllerBase
{
    private static readonly JsonSerializerOptions _jsonOut =
        new() { WriteIndented = true };

    // ── GET /api/config ───────────────────────────────────────────────────────

    [HttpGet]
    public IActionResult Get()
    {
        var projects    = config.GetSection("Ado:Projects").Get<string[]>() ?? [];
        var testProject = config["Ado:TestProject"] ?? "AutomatedTests";
        var refreshSecs = int.TryParse(config["App:RefreshSeconds"], out var s) ? s : 30;
        var isDefault   = IsUnconfigured();

        var uatProject    = config["Uat:Project"]     ?? "";
        var uatPipelineId = int.TryParse(config["Uat:PipelineId"], out var uid) ? uid : 0;
        var uatBranch     = config["Uat:Branch"]      ?? "";
        var emailEnabled  = config["Email:Enabled"]?.Equals("true", StringComparison.OrdinalIgnoreCase) == true;
        var emailTo       = config["Email:To"]        ?? "";
        var emailFrom     = config["Email:From"]      ?? "";
        var smtpHost      = config["Email:SmtpHost"]  ?? "";
        var smtpPort      = int.TryParse(config["Email:SmtpPort"], out var ep) ? ep : 587;
        var digestHour    = int.TryParse(config["Email:DigestHour"], out var dh) ? dh : 8;

        return Ok(new
        {
            org = config["Ado:Organisation"] ?? "",
            projects,
            testProject,
            refreshSecs,
            isDefault,   // tells the frontend to open the setup modal automatically
            uatProject,
            uatPipelineId,
            uatBranch,
            emailEnabled,
            emailTo,
            emailFrom,
            smtpHost,
            smtpPort,
            digestHour,
        });
    }

    // ── PUT /api/config ───────────────────────────────────────────────────────
    // Persists new settings to appsettings.user.json (which overrides appsettings.json).
    // PAT is optional — if omitted/blank the existing PAT is kept.

    [HttpPut]
    public IActionResult Save([FromBody] SaveConfigRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Organisation))
        {
            return BadRequest(new { error = "organisation is required" });
        }

        if ((req.Projects == null || req.Projects.Length == 0))
        {
            return BadRequest(new { error = "at least one project is required" });
        }

        var userFile = Path.Combine(env.ContentRootPath, "appsettings.user.json");

        // Read existing user config so we can preserve any keys we're not touching (e.g. Audit)
        JsonObject root;
        if (System.IO.File.Exists(userFile))
        {
            try { root = JsonNode.Parse(System.IO.File.ReadAllText(userFile))?.AsObject() ?? []; }
            catch { root = []; }
        }
        else
        {
            root = [];
        }

        // Build / replace the Ado section
        var adoSection = new JsonObject
        {
            ["Organisation"] = req.Organisation.Trim(),
            ["Projects"]     = new JsonArray(req.Projects
                                    .Where(p => !string.IsNullOrWhiteSpace(p))
                                    .Select(p => JsonValue.Create(p.Trim())!)
                                    .ToArray<JsonNode>()),
            ["TestProject"]  = (req.TestProject ?? "AutomatedTests").Trim(),
        };

        // Only write the PAT if a new one was supplied (blank = keep existing)
        if (!string.IsNullOrWhiteSpace(req.Pat))
        {
            adoSection["Pat"] = req.Pat.Trim();
        }
        else if (root["Ado"]?["Pat"] is JsonValue existingPat)
        {
            adoSection["Pat"] = existingPat.GetValue<string>();
        }
        else
        {
            adoSection["Pat"] = config["Ado:Pat"] ?? ""; // fall back to appsettings.json value
        }

        root["Ado"] = adoSection;

        if (req.RefreshSecs.HasValue && req.RefreshSecs.Value >= 10)
        {
            if (root["App"] is not JsonObject appSection)
            {
                root["App"] = appSection = [];
            }
            appSection["RefreshSeconds"] = req.RefreshSecs.Value;
        }

        // UAT pipeline settings
        if (req.UatProject != null || req.UatPipelineId.HasValue || req.UatBranch != null)
        {
            if (root["Uat"] is not JsonObject uatSection)
            {
                root["Uat"] = uatSection = [];
            }
            if (req.UatProject     != null)    uatSection["Project"]    = req.UatProject.Trim();
            if (req.UatPipelineId.HasValue)    uatSection["PipelineId"] = req.UatPipelineId.Value;
            if (req.UatBranch      != null)    uatSection["Branch"]     = req.UatBranch.Trim();
        }

        // Email / SMTP settings
        if (req.EmailEnabled.HasValue || req.EmailTo != null || req.SmtpHost != null)
        {
            if (root["Email"] is not JsonObject emailSection)
            {
                root["Email"] = emailSection = [];
            }
            if (req.EmailEnabled.HasValue) emailSection["Enabled"]    = req.EmailEnabled.Value ? "true" : "false";
            if (req.EmailTo    != null)    emailSection["To"]         = req.EmailTo.Trim();
            if (req.EmailFrom  != null)    emailSection["From"]       = req.EmailFrom.Trim();
            if (req.SmtpHost   != null)    emailSection["SmtpHost"]   = req.SmtpHost.Trim();
            if (req.SmtpPort.HasValue)     emailSection["SmtpPort"]   = req.SmtpPort.Value;
            if (req.SmtpUser   != null)    emailSection["SmtpUser"]   = req.SmtpUser.Trim();
            if (req.SmtpPass   != null)    emailSection["SmtpPass"]   = req.SmtpPass.Trim();
            if (req.DigestHour.HasValue)   emailSection["DigestHour"] = req.DigestHour.Value;
        }

        System.IO.File.WriteAllText(userFile,
            JsonSerializer.Serialize(root, _jsonOut));

        return Ok(new { message = "Settings saved. Restart the server for PAT changes to take effect." });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private bool IsUnconfigured()
        => string.IsNullOrWhiteSpace(config["Ado:Organisation"])
        || config["Ado:Organisation"] == "your-org"
        || string.IsNullOrWhiteSpace(config["Ado:Pat"])
        || config["Ado:Pat"] == "your-pat";
}

// ── Request model ─────────────────────────────────────────────────────────────

public record SaveConfigRequest(
    string    Organisation,
    string[]  Projects,
    string?   TestProject   = null,
    string?   Pat           = null,
    int?      RefreshSecs   = null,
    string?   UatProject    = null,
    int?      UatPipelineId = null,
    string?   UatBranch     = null,
    bool?     EmailEnabled  = null,
    string?   EmailTo       = null,
    string?   EmailFrom     = null,
    string?   SmtpHost      = null,
    int?      SmtpPort      = null,
    string?   SmtpUser      = null,
    string?   SmtpPass      = null,
    int?      DigestHour    = null);