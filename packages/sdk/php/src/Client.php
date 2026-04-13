<?php

declare(strict_types=1);

namespace Bugwatch;

use Bugwatch\Transport\HttpTransport;
use Bugwatch\Transport\TransportInterface;
use Bugwatch\Types\ErrorEvent;
use Bugwatch\Types\ExceptionInfo;
use Bugwatch\Types\Level;

final class Client
{
    private readonly TransportInterface $transport;

    /** @var ErrorEvent[] */
    private array $queue = [];

    public function __construct(
        private readonly Options $options,
        ?TransportInterface $transport = null,
    ) {
        $this->transport = $transport ?? new HttpTransport($this->options);
    }

    public function getOptions(): Options
    {
        return $this->options;
    }

    public function getTransport(): TransportInterface
    {
        return $this->transport;
    }

    /**
     * @param array<string, mixed> $context
     */
    public function captureException(\Throwable $exception, array $context = []): ?string
    {
        $scope = ScopeManager::getInstance();
        $frames = StackTraceParser::parse($exception);

        $exceptionInfo = new ExceptionInfo(
            type: get_class($exception),
            value: $exception->getMessage(),
            stacktrace: $frames,
        );

        $event = new ErrorEvent(
            id: bin2hex(random_bytes(16)),
            timestamp: microtime(true),
            level: Level::Error,
            serverName: gethostname() ?: null,
            environment: $this->options->environment,
            release: $this->options->release,
            exception: $exceptionInfo,
            user: $scope->getUser(),
            request: $context['request'] ?? null,
            breadcrumbs: $scope->getBreadcrumbs(),
            tags: array_merge($scope->getTags(), $context['tags'] ?? []),
            extra: array_merge($scope->getExtras(), $context['extra'] ?? []),
        );

        $fingerprint = Fingerprint::generate($event);
        $event = new ErrorEvent(
            id: $event->id,
            timestamp: $event->timestamp,
            level: $event->level,
            serverName: $event->serverName,
            environment: $event->environment,
            release: $event->release,
            exception: $event->exception,
            user: $event->user,
            request: $event->request,
            breadcrumbs: $event->breadcrumbs,
            tags: $event->tags,
            extra: $event->extra,
            fingerprint: [$fingerprint],
        );

        return $this->processEvent($event);
    }

    /**
     * @param array<string, mixed> $context
     */
    public function captureMessage(string $message, Level $level = Level::Error, array $context = []): ?string
    {
        $scope = ScopeManager::getInstance();

        $event = new ErrorEvent(
            id: bin2hex(random_bytes(16)),
            timestamp: microtime(true),
            level: $level,
            serverName: gethostname() ?: null,
            environment: $this->options->environment,
            release: $this->options->release,
            exception: new ExceptionInfo(
                type: 'Message',
                value: $message,
            ),
            user: $scope->getUser(),
            breadcrumbs: $scope->getBreadcrumbs(),
            tags: array_merge($scope->getTags(), $context['tags'] ?? []),
            extra: array_merge($scope->getExtras(), $context['extra'] ?? []),
        );

        $fingerprint = Fingerprint::generate($event);
        $event = new ErrorEvent(
            id: $event->id,
            timestamp: $event->timestamp,
            level: $event->level,
            serverName: $event->serverName,
            environment: $event->environment,
            release: $event->release,
            exception: $event->exception,
            user: $event->user,
            request: $event->request,
            breadcrumbs: $event->breadcrumbs,
            tags: $event->tags,
            extra: $event->extra,
            fingerprint: [$fingerprint],
        );

        return $this->processEvent($event);
    }

    public function flush(): void
    {
        foreach ($this->queue as $event) {
            $this->transport->send($event);
        }

        $this->queue = [];
    }

    public function close(): void
    {
        $this->flush();
    }

    private function processEvent(ErrorEvent $event): ?string
    {
        // Apply beforeSend callback
        if ($this->options->beforeSend !== null) {
            $event = ($this->options->beforeSend)($event);
            if ($event === null) {
                if ($this->options->debug) {
                    error_log('[Bugwatch] Event dropped by beforeSend callback');
                }

                return null;
            }
        }

        $sent = $this->transport->send($event);

        if (!$sent && $this->options->debug) {
            error_log('[Bugwatch] Failed to send event ' . $event->id);
        }

        return $sent ? $event->id : null;
    }
}
