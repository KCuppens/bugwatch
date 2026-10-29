<?php

declare(strict_types=1);

namespace Bugwatch;

use Bugwatch\Types\StackFrame;

final class StackTraceParser
{
    /**
     * @return StackFrame[]
     */
    public static function parse(\Throwable $e): array
    {
        $frames = [];
        $trace = $e->getTrace();

        // Add the exception origin as the first frame
        $frames[] = new StackFrame(
            filename: self::normalizeFilename($e->getFile()),
            function: null,
            lineno: $e->getLine(),
            absPath: $e->getFile(),
            inApp: self::isInApp($e->getFile()),
        );

        foreach ($trace as $frame) {
            $file = $frame['file'] ?? null;
            $function = isset($frame['class'])
                ? $frame['class'] . ($frame['type'] ?? '::') . $frame['function']
                : $frame['function'];

            $frames[] = new StackFrame(
                filename: $file !== null ? self::normalizeFilename($file) : null,
                function: $function,
                lineno: $frame['line'] ?? null,
                absPath: $file,
                inApp: $file !== null ? self::isInApp($file) : true,
            );
        }

        return $frames;
    }

    private static function isInApp(string $filepath): bool
    {
        $normalized = str_replace('\\', '/', $filepath);

        return !str_contains($normalized, '/vendor/');
    }

    private static function normalizeFilename(string $filepath): string
    {
        $normalized = str_replace('\\', '/', $filepath);

        // Try to make path relative to project root
        $cwd = getcwd();
        if ($cwd !== false) {
            $cwd = str_replace('\\', '/', $cwd);
            if (str_starts_with($normalized, $cwd)) {
                return ltrim(substr($normalized, strlen($cwd)), '/');
            }
        }

        return $normalized;
    }
}
