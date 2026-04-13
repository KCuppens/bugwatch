<?php

declare(strict_types=1);

namespace Bugwatch\Transport;

use Bugwatch\Types\ErrorEvent;

final class ConsoleTransport implements TransportInterface
{
    public function send(ErrorEvent $event): bool
    {
        $data = $event->toArray();
        $output = json_encode($data, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR);
        error_log('[Bugwatch] Event ' . $event->id . ': ' . $output);

        return true;
    }
}
