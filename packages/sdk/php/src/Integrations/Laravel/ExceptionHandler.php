<?php

declare(strict_types=1);

namespace Bugwatch\Integrations\Laravel;

use Bugwatch\Bugwatch;

/**
 * Trait to be used in your application's exception handler.
 *
 * Usage in app/Exceptions/Handler.php:
 *
 *     use Bugwatch\Integrations\Laravel\ExceptionHandler as BugwatchExceptionHandler;
 *
 *     class Handler extends ExceptionHandler
 *     {
 *         use BugwatchExceptionHandler;
 *
 *         public function register(): void
 *         {
 *             $this->reportable(function (Throwable $e) {
 *                 $this->reportToBugwatch($e);
 *             });
 *         }
 *     }
 */
trait ExceptionHandler
{
    /**
     * Report an exception to Bugwatch.
     *
     * @param array<string, mixed> $context
     */
    protected function reportToBugwatch(\Throwable $exception, array $context = []): void
    {
        Bugwatch::captureException($exception, $context);
    }
}
