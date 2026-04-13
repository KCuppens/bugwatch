<?php

declare(strict_types=1);

namespace Bugwatch;

final class Options
{
    /** @var (callable(\Bugwatch\Types\ErrorEvent): ?\Bugwatch\Types\ErrorEvent)|null */
    public readonly mixed $beforeSend;

    public function __construct(
        public readonly string $apiKey = '',
        public readonly ?string $environment = null,
        public readonly ?string $release = null,
        public readonly string $serverUrl = 'https://api.bugwatch.dev',
        public readonly bool $debug = false,
        ?callable $beforeSend = null,
    ) {
        $this->beforeSend = $beforeSend;
    }

    /**
     * Create Options from environment variables with optional overrides.
     *
     * @param array<string, mixed> $overrides
     */
    public static function fromEnvironment(array $overrides = []): self
    {
        return new self(
            apiKey: (string) ($overrides['apiKey'] ?? getenv('BUGWATCH_API_KEY') ?: ''),
            environment: $overrides['environment'] ?? getenv('BUGWATCH_ENVIRONMENT') ?: null,
            release: $overrides['release'] ?? getenv('BUGWATCH_RELEASE') ?: null,
            serverUrl: (string) ($overrides['serverUrl'] ?? getenv('BUGWATCH_SERVER_URL') ?: 'https://api.bugwatch.dev'),
            debug: (bool) ($overrides['debug'] ?? getenv('BUGWATCH_DEBUG') ?: false),
            beforeSend: $overrides['beforeSend'] ?? null,
        );
    }
}
