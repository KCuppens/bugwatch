<?php

declare(strict_types=1);

namespace Bugwatch\Tests;

use Bugwatch\Bugwatch;
use Bugwatch\Client;
use Bugwatch\Options;
use Bugwatch\ScopeManager;
use Bugwatch\Transport\TransportInterface;
use Bugwatch\Types\ErrorEvent;
use Bugwatch\Types\Level;
use PHPUnit\Framework\TestCase;

final class BugwatchTest extends TestCase
{
    private MockTransport $transport;

    protected function setUp(): void
    {
        ScopeManager::reset();
        Bugwatch::close();
    }

    protected function tearDown(): void
    {
        Bugwatch::close();
    }

    public function testInitCreatesClient(): void
    {
        Bugwatch::init(new Options(
            apiKey: 'test-key',
            environment: 'testing',
        ));

        $this->assertNotNull(Bugwatch::getClient());
    }

    public function testCaptureExceptionReturnsEventId(): void
    {
        $transport = new MockTransport();
        $options = new Options(apiKey: 'test-key', environment: 'testing');
        $client = new Client($options, $transport);

        $eventId = $client->captureException(new \RuntimeException('Test error'));

        $this->assertNotNull($eventId);
        $this->assertCount(1, $transport->events);
        $this->assertSame('php', $transport->events[0]->platform);
        $this->assertSame('testing', $transport->events[0]->environment);
    }

    public function testCaptureExceptionCapturesExceptionDetails(): void
    {
        $transport = new MockTransport();
        $options = new Options(apiKey: 'test-key');
        $client = new Client($options, $transport);

        $client->captureException(new \RuntimeException('Something went wrong'));

        $event = $transport->events[0];
        $this->assertNotNull($event->exception);
        $this->assertSame('RuntimeException', $event->exception->type);
        $this->assertSame('Something went wrong', $event->exception->value);
        $this->assertNotEmpty($event->exception->stacktrace);
    }

    public function testCaptureExceptionCapturesPrimaryException(): void
    {
        $transport = new MockTransport();
        $options = new Options(apiKey: 'test-key');
        $client = new Client($options, $transport);

        $previous = new \InvalidArgumentException('Root cause');
        $exception = new \RuntimeException('Wrapped error', 0, $previous);

        $client->captureException($exception);

        $event = $transport->events[0];
        $this->assertNotNull($event->exception);
        $this->assertSame('RuntimeException', $event->exception->type);
    }

    public function testCaptureMessageReturnsEventId(): void
    {
        $transport = new MockTransport();
        $options = new Options(apiKey: 'test-key', environment: 'testing');
        $client = new Client($options, $transport);

        $eventId = $client->captureMessage('Test message', Level::Warning);

        $this->assertNotNull($eventId);
        $this->assertCount(1, $transport->events);
        $this->assertSame(Level::Warning, $transport->events[0]->level);
    }

    public function testCaptureMessageIncludesMessageInExceptions(): void
    {
        $transport = new MockTransport();
        $options = new Options(apiKey: 'test-key');
        $client = new Client($options, $transport);

        $client->captureMessage('Hello from Bugwatch');

        $event = $transport->events[0];
        $this->assertNotNull($event->exception);
        $this->assertSame('Message', $event->exception->type);
        $this->assertSame('Hello from Bugwatch', $event->exception->value);
    }

    public function testBeforeSendCanDropEvent(): void
    {
        $transport = new MockTransport();
        $options = new Options(
            apiKey: 'test-key',
            beforeSend: fn (ErrorEvent $event): ?ErrorEvent => null,
        );
        $client = new Client($options, $transport);

        $eventId = $client->captureException(new \RuntimeException('dropped'));

        $this->assertNull($eventId);
        $this->assertCount(0, $transport->events);
    }

    public function testBeforeSendCanModifyEvent(): void
    {
        $transport = new MockTransport();
        $options = new Options(
            apiKey: 'test-key',
            beforeSend: fn (ErrorEvent $event): ErrorEvent => new ErrorEvent(
                id: $event->id,
                timestamp: $event->timestamp,
                level: $event->level,
                environment: $event->environment,
                exception: $event->exception,
                tags: ['modified' => 'true'],
            ),
        );
        $client = new Client($options, $transport);

        $client->captureException(new \RuntimeException('test'));

        $this->assertSame(['modified' => 'true'], $transport->events[0]->tags);
    }

    public function testStaticFacadeReturnsNullWhenNotInitialized(): void
    {
        $result = Bugwatch::captureException(new \RuntimeException('test'));
        $this->assertNull($result);

        $result = Bugwatch::captureMessage('test');
        $this->assertNull($result);
    }

    public function testScopeManagerAddsContextToEvents(): void
    {
        $transport = new MockTransport();
        $options = new Options(apiKey: 'test-key');
        $client = new Client($options, $transport);

        $scope = ScopeManager::getInstance();
        $scope->setTags(['service' => 'api']);
        $scope->setExtras(['request_id' => 'abc123']);

        $client->captureException(new \RuntimeException('test'));

        $event = $transport->events[0];
        $this->assertSame('api', $event->tags['service']);
        $this->assertSame('abc123', $event->extra['request_id']);
    }

    public function testEventHasFingerprint(): void
    {
        $transport = new MockTransport();
        $options = new Options(apiKey: 'test-key');
        $client = new Client($options, $transport);

        $client->captureException(new \RuntimeException('test'));

        $event = $transport->events[0];
        $this->assertNotEmpty($event->fingerprint);
        $this->assertCount(1, $event->fingerprint);
        $this->assertSame(64, strlen($event->fingerprint[0])); // SHA-256 hex
    }

    public function testEventToArrayProducesCorrectStructure(): void
    {
        $transport = new MockTransport();
        $options = new Options(apiKey: 'test-key', environment: 'testing', release: '1.0.0');
        $client = new Client($options, $transport);

        $client->captureException(new \RuntimeException('test'));

        $data = $transport->events[0]->toArray();
        $this->assertArrayHasKey('event_id', $data);
        $this->assertArrayHasKey('timestamp', $data);
        $this->assertArrayHasKey('level', $data);
        $this->assertArrayHasKey('platform', $data);
        $this->assertArrayHasKey('exception', $data);
        $this->assertSame('error', $data['level']);
        $this->assertSame('php', $data['platform']);
        $this->assertSame('testing', $data['environment']);
        $this->assertSame('1.0.0', $data['release']);
    }
}

/**
 * @internal
 */
final class MockTransport implements TransportInterface
{
    /** @var ErrorEvent[] */
    public array $events = [];

    public function send(ErrorEvent $event): bool
    {
        $this->events[] = $event;

        return true;
    }
}
