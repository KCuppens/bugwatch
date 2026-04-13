<?php

declare(strict_types=1);

return [
    /*
    |--------------------------------------------------------------------------
    | Bugwatch API Key
    |--------------------------------------------------------------------------
    |
    | Your project's API key from the Bugwatch dashboard.
    |
    */
    'api_key' => env('BUGWATCH_API_KEY', ''),

    /*
    |--------------------------------------------------------------------------
    | Environment
    |--------------------------------------------------------------------------
    |
    | The environment name for this deployment (e.g., production, staging).
    | Defaults to Laravel's app environment if not set.
    |
    */
    'environment' => env('BUGWATCH_ENVIRONMENT', null),

    /*
    |--------------------------------------------------------------------------
    | Release
    |--------------------------------------------------------------------------
    |
    | The release/version identifier for this deployment.
    |
    */
    'release' => env('BUGWATCH_RELEASE', null),

    /*
    |--------------------------------------------------------------------------
    | Server URL
    |--------------------------------------------------------------------------
    |
    | The Bugwatch API server URL. Override for self-hosted installations.
    |
    */
    'server_url' => env('BUGWATCH_SERVER_URL', 'https://api.bugwatch.dev'),

    /*
    |--------------------------------------------------------------------------
    | Debug Mode
    |--------------------------------------------------------------------------
    |
    | Enable debug logging for the SDK. Not recommended for production.
    |
    */
    'debug' => env('BUGWATCH_DEBUG', false),
];
