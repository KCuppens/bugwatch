<?php

declare(strict_types=1);

namespace Bugwatch\Transport;

use Bugwatch\Types\ErrorEvent;

interface TransportInterface
{
    public function send(ErrorEvent $event): bool;
}
