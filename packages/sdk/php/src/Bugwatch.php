<?php

declare(strict_types=1);

namespace Bugwatch;

use Bugwatch\Types\Level;

final class Bugwatch
{
    private static ?Client $client = null;

    private static mixed $previousExceptionHandler = null;

    private static mixed $previousErrorHandler = null;

    private function __construct() {}

    public static function init(Options $options): void
    {
        self::$client = new Client($options);

        if ($options->debug) {
            error_log('[Bugwatch] SDK initialized');
        }
    }

    public static function getClient(): ?Client
    {
        return self::$client;
    }

    /**
     * @param array<string, mixed> $context
     */
    public static function captureException(\Throwable $exception, array $context = []): ?string
    {
        if (self::$client === null) {
            return null;
        }

        return self::$client->captureException($exception, $context);
    }

    /**
     * @param array<string, mixed> $context
     */
    public static function captureMessage(
        string $message,
        Level $level = Level::Error,
        array $context = [],
    ): ?string {
        if (self::$client === null) {
            return null;
        }

        return self::$client->captureMessage($message, $level, $context);
    }

    public static function flush(): void
    {
        self::$client?->flush();
    }

    public static function close(): void
    {
        self::$client?->close();
        self::$client = null;
    }

    public static function installErrorHandlers(): void
    {
        // Set exception handler
        $previous = set_exception_handler(static function (\Throwable $exception): void {
            self::captureException($exception);

            if (self::$previousExceptionHandler !== null) {
                (self::$previousExceptionHandler)($exception);
            }
        });
        self::$previousExceptionHandler = $previous;

        // Set error handler
        $previous = set_error_handler(static function (
            int $errno,
            string $errstr,
            string $errfile = '',
            int $errline = 0,
        ): bool {
            $level = match ($errno) {
                E_ERROR, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR, E_RECOVERABLE_ERROR => Level::Error,
                E_WARNING, E_CORE_WARNING, E_COMPILE_WARNING, E_USER_WARNING => Level::Warning,
                E_NOTICE, E_USER_NOTICE, E_STRICT, E_DEPRECATED, E_USER_DEPRECATED => Level::Info,
                default => Level::Error,
            };

            self::captureMessage(
                message: sprintf('%s in %s on line %d', $errstr, $errfile, $errline),
                level: $level,
                context: [
                    'extra' => [
                        'error_code' => $errno,
                        'file' => $errfile,
                        'line' => $errline,
                    ],
                ],
            );

            // Call previous handler if it exists
            if (self::$previousErrorHandler !== null) {
                return (self::$previousErrorHandler)($errno, $errstr, $errfile, $errline);
            }

            // Return false to let PHP's default handler run too
            return false;
        });
        self::$previousErrorHandler = $previous;

        // Register shutdown function for fatal errors
        register_shutdown_function(static function (): void {
            $error = error_get_last();

            if ($error !== null && in_array($error['type'], [E_ERROR, E_CORE_ERROR, E_COMPILE_ERROR, E_PARSE], true)) {
                self::captureMessage(
                    message: sprintf('%s in %s on line %d', $error['message'], $error['file'], $error['line']),
                    level: Level::Fatal,
                    context: [
                        'extra' => [
                            'error_type' => $error['type'],
                            'file' => $error['file'],
                            'line' => $error['line'],
                        ],
                    ],
                );

                self::flush();
            }

            self::close();
        });
    }
}
