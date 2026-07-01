var builder = WebApplication.CreateBuilder(args);

// appsettings.user.json overrides appsettings.json — written by PUT /api/config from the UI
builder.Configuration.AddJsonFile(
    Path.Combine(builder.Environment.ContentRootPath, "appsettings.user.json"),
    optional: true,
    reloadOnChange: true);

builder.Services.AddControllers();
builder.Services.AddMemoryCache();
builder.Services.AddHttpClient();
builder.Services.AddSingleton<NexusMDWeb.Api.Services.OAuth.ITokenExchanger,
                              NexusMDWeb.Api.Services.OAuth.HttpTokenExchanger>();
builder.Services.AddSingleton<NexusMDWeb.Api.Services.OAuth.IOneTimeCodeStore,
                              NexusMDWeb.Api.Services.OAuth.MemoryOneTimeCodeStore>();

// Profile registry (SQLite-backed) consumed by /api/profiles.
builder.Services.AddSingleton<NexusMDWeb.Api.Data.ProfileRepository>();
builder.Services.AddSingleton<NexusMDWeb.Api.Services.ProfileService>();

// Allow the Capacitor Android app to call the API. "nexus.app" is the
// WebView's virtual hostname (capacitor.config.json); "nexusmd.app" is the
// deployed API/web origin used as the desktop/app VITE_API_BASE default.
builder.Services.AddCors(options =>
{
    options.AddPolicy("CapacitorApp", policy =>
    {
        policy.WithOrigins("https://nexusmd.app", "https://nexus.app")
              .WithHeaders("Content-Type", "Authorization", "X-Requested-With")
              .WithMethods("GET", "POST", "PUT", "DELETE", "OPTIONS");
    });
});

var app = builder.Build();

app.UseCors("CapacitorApp");

// Serve the single-page frontend from wwwroot/
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapControllers();
app.MapFallbackToFile("index.html");
app.Run();

// Exposed so the integration test project can spin up the host via WebApplicationFactory<Program>.
public partial class Program { }
