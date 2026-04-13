<?php

declare(strict_types=1);

namespace Bugwatch\Integrations\Laravel;

use Bugwatch\Bugwatch;
use Bugwatch\Options;
use Illuminate\Support\ServiceProvider;

final class BugwatchServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(
            __DIR__ . '/config/bugwatch.php',
            'bugwatch',
        );

        $this->app->singleton(Bugwatch::class, function (): void {
            /** @var array<string, mixed> $config */
            $config = config('bugwatch', []);

            Bugwatch::init(new Options(
                apiKey: (string) ($config['api_key'] ?? ''),
                environment: $config['environment'] ?? app()->environment(),
                release: $config['release'] ?? null,
                serverUrl: (string) ($config['server_url'] ?? 'https://api.bugwatch.dev'),
                debug: (bool) ($config['debug'] ?? false),
            ));
        });
    }

    public function boot(): void
    {
        $this->publishes([
            __DIR__ . '/config/bugwatch.php' => config_path('bugwatch.php'),
        ], 'bugwatch-config');

        // Initialize the SDK
        $this->app->make(Bugwatch::class);

        // Register the middleware
        /** @var \Illuminate\Routing\Router $router */
        $router = $this->app->make('router');
        $router->pushMiddlewareToGroup('web', BugwatchMiddleware::class);
        $router->pushMiddlewareToGroup('api', BugwatchMiddleware::class);

        // Install error handlers
        Bugwatch::installErrorHandlers();
    }
}
