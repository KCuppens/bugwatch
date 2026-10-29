<?php

declare(strict_types=1);

namespace Bugwatch\Types;

final class UserContext
{
    public function __construct(
        public readonly ?string $id = null,
        public readonly ?string $email = null,
        public readonly ?string $username = null,
        public readonly ?string $ipAddress = null,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return array_filter([
            'id' => $this->id,
            'email' => $this->email,
            'username' => $this->username,
            'ip_address' => $this->ipAddress,
        ], fn (mixed $value): bool => $value !== null);
    }
}
