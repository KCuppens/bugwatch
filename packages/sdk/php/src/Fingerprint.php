<?php

declare(strict_types=1);

namespace Bugwatch;

use Bugwatch\Types\ErrorEvent;

final class Fingerprint
{
    public static function generate(ErrorEvent $event): string
    {
        $parts = [];

        if ($event->exception !== null) {
            $parts[] = $event->exception->type;
            $parts[] = $event->exception->value;

            if (count($event->exception->stacktrace) > 0) {
                $topFrame = $event->exception->stacktrace[0];
                $parts[] = $topFrame->filename ?? '';
                $parts[] = $topFrame->function ?? '';
                $parts[] = (string) ($topFrame->lineno ?? 0);
            }
        }

        if ($parts === []) {
            $parts[] = $event->level->value;
            $parts[] = $event->id;
        }

        return hash('sha256', implode('|', $parts));
    }
}
