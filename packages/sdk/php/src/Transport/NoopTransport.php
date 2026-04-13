<?php

declare(strict_types=1);

namespace Bugwatch\Transport;

use Bugwatch\Types\ErrorEvent;

final class NoopTransport implements TransportInterface
{
    public function send(ErrorEvent $event): bool
    {
        return true;
    }
}
