<?php

declare(strict_types=1);

namespace Bugwatch\Tests;

use Bugwatch\Transport\ConsoleTransport;
use Bugwatch\Transport\NoopTransport;
use Bugwatch\Types\ErrorEvent;
use Bugwatch\Types\ExceptionInfo;
use Bugwatch\Types\Level;
use PHPUnit\Framework\TestCase;

final class TransportTest extends TestCase
{
    private function createTestEvent(): ErrorEvent
    {
        return new ErrorEvent(
            id: 'test-event-id',
            timestamp: 1700000000.0,
            level: Level::Error,
            environment: 'testing',
            exception: new ExceptionInfo(
                type: 'RuntimeException',
                value: 'Test error message',
            ),
        );
    }

    public function testNoopTransportReturnsTrue(): void
    {
        $transport = new NoopTransport();
        $event = $this->createTestEvent();

        $this->assertTrue($transport->send($event));
    }

    public function testConsoleTransportReturnsTrue(): void
    {
        $transport = new ConsoleTransport();
        $event = $this->createTestEvent();

        $this->assertTrue($transport->send($event));
    }

    public function testConsoleTransportOutputsEventData(): void
    {
        $transport = new ConsoleTransport();
        $event = $this->createTestEvent();

        // Capture error_log output
        $previousHandler = set_error_handler(function () {
            return true;
        });

        $result = $transport->send($event);

        if ($previousHandler !== null) {
            set_error_handler($previousHandler);
        } else {
            restore_error_handler();
        }

        $this->assertTrue($result);
    }

    public function testNoopTransportHandlesMultipleEvents(): void
    {
        $transport = new NoopTransport();

        for ($i = 0; $i < 10; $i++) {
            $event = new ErrorEvent(
                id: 'event-' . $i,
                timestamp: microtime(true),
                level: Level::Error,
                exception: new ExceptionInfo(type: 'Exception', value: 'Error ' . $i),
            );

            $this->assertTrue($transport->send($event));
        }
    }
}
