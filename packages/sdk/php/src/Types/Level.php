<?php

declare(strict_types=1);

namespace Bugwatch\Types;

enum Level: string
{
    case Debug = 'debug';
    case Info = 'info';
    case Warning = 'warning';
    case Error = 'error';
    case Fatal = 'fatal';
}
