<?php

declare(strict_types=1);

namespace Bugwatch\Types;

final class ErrorEvent
{
    /**
     * @param Breadcrumb[] $breadcrumbs
     * @param array<string, string> $tags
     * @param array<string, mixed> $extra
     * @param string[] $fingerprint
     */
    public function __construct(
        public readonly string $id,
        public readonly float $timestamp,
        public readonly Level $level = Level::Error,
        public readonly string $platform = 'php',
        public readonly ?string $serverName = null,
        public readonly ?string $environment = null,
        public readonly ?string $release = null,
        public readonly ?ExceptionInfo $exception = null,
        public readonly ?UserContext $user = null,
        public readonly ?RequestContext $request = null,
        public readonly array $breadcrumbs = [],
        public readonly array $tags = [],
        public readonly array $extra = [],
        public readonly array $fingerprint = [],
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return array_filter([
            'event_id' => $this->id,
            'timestamp' => $this->timestamp,
            'level' => $this->level->value,
            'platform' => $this->platform,
            'server_name' => $this->serverName,
            'environment' => $this->environment,
            'release' => $this->release,
            'exception' => $this->exception?->toArray(),
            'user' => $this->user?->toArray(),
            'request' => $this->request?->toArray(),
            'breadcrumbs' => array_map(
                fn (Breadcrumb $b): array => $b->toArray(),
                $this->breadcrumbs,
            ) ?: null,
            'tags' => $this->tags ?: null,
            'extra' => $this->extra ?: null,
            'fingerprint' => $this->fingerprint ?: null,
        ], fn (mixed $value): bool => $value !== null);
    }
}
