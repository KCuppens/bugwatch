<?php

declare(strict_types=1);

namespace Bugwatch\Tests;

use Bugwatch\Fingerprint;
use Bugwatch\Types\ErrorEvent;
use Bugwatch\Types\ExceptionInfo;
use Bugwatch\Types\Level;
use Bugwatch\Types\StackFrame;
use PHPUnit\Framework\TestCase;

final class FingerprintTest extends TestCase
{
    public function testGenerateReturnsSha256Hash(): void
    {
        $event = new ErrorEvent(
            id: 'test-id',
            timestamp: microtime(true),
            exception: new ExceptionInfo(
                type: 'RuntimeException',
                value: 'Something failed',
                stacktrace: [
                    new StackFrame(
                        filename: 'src/Service.php',
                        function: 'doWork',
                        lineno: 42,
                    ),
                ],
            ),
        );

        $fingerprint = Fingerprint::generate($event);

        $this->assertSame(64, strlen($fingerprint));
        $this->assertMatchesRegularExpression('/^[a-f0-9]{64}$/', $fingerprint);
    }

    public function testSameExceptionProducesSameFingerprint(): void
    {
        $makeEvent = fn (): ErrorEvent => new ErrorEvent(
            id: bin2hex(random_bytes(16)),
            timestamp: microtime(true),
            exception: new ExceptionInfo(
                type: 'RuntimeException',
                value: 'Same error',
                stacktrace: [
                    new StackFrame(
                        filename: 'src/Service.php',
                        function: 'doWork',
                        lineno: 42,
                    ),
                ],
            ),
        );

        $fp1 = Fingerprint::generate($makeEvent());
        $fp2 = Fingerprint::generate($makeEvent());

        $this->assertSame($fp1, $fp2);
    }

    public function testDifferentExceptionsProduceDifferentFingerprints(): void
    {
        $event1 = new ErrorEvent(
            id: 'test-1',
            timestamp: microtime(true),
            exception: new ExceptionInfo(type: 'RuntimeException', value: 'Error A'),
        );

        $event2 = new ErrorEvent(
            id: 'test-2',
            timestamp: microtime(true),
            exception: new ExceptionInfo(type: 'InvalidArgumentException', value: 'Error B'),
        );

        $this->assertNotSame(
            Fingerprint::generate($event1),
            Fingerprint::generate($event2),
        );
    }

    public function testFingerprintWithoutExceptionsFallsBackToLevel(): void
    {
        $event = new ErrorEvent(
            id: 'test-id',
            timestamp: microtime(true),
            level: Level::Warning,
        );

        $fingerprint = Fingerprint::generate($event);

        $this->assertSame(64, strlen($fingerprint));
    }
}
