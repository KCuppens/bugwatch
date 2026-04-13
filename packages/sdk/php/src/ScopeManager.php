<?php

declare(strict_types=1);

namespace Bugwatch;

use Bugwatch\Types\Breadcrumb;
use Bugwatch\Types\Level;
use Bugwatch\Types\UserContext;

final class ScopeManager
{
    private static ?self $instance = null;

    private ?UserContext $user = null;

    /** @var array<string, string> */
    private array $tags = [];

    /** @var array<string, mixed> */
    private array $extras = [];

    /** @var Breadcrumb[] */
    private array $breadcrumbs = [];

    private int $maxBreadcrumbs = 100;

    private function __construct() {}

    public static function getInstance(): self
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }

        return self::$instance;
    }

    public static function reset(): void
    {
        self::$instance = null;
    }

    public function setUser(?UserContext $user): void
    {
        $this->user = $user;
    }

    public function getUser(): ?UserContext
    {
        return $this->user;
    }

    /**
     * @param array<string, string> $tags
     */
    public function setTags(array $tags): void
    {
        $this->tags = array_merge($this->tags, $tags);
    }

    /**
     * @return array<string, string>
     */
    public function getTags(): array
    {
        return $this->tags;
    }

    /**
     * @param array<string, mixed> $extras
     */
    public function setExtras(array $extras): void
    {
        $this->extras = array_merge($this->extras, $extras);
    }

    /**
     * @return array<string, mixed>
     */
    public function getExtras(): array
    {
        return $this->extras;
    }

    public function addBreadcrumb(Breadcrumb $breadcrumb): void
    {
        $this->breadcrumbs[] = $breadcrumb;

        if (count($this->breadcrumbs) > $this->maxBreadcrumbs) {
            $this->breadcrumbs = array_slice($this->breadcrumbs, -$this->maxBreadcrumbs);
        }
    }

    /**
     * @param array<string, mixed> $data
     */
    public function addBreadcrumbSimple(
        string $category,
        string $message = '',
        Level $level = Level::Info,
        array $data = [],
    ): void {
        $this->addBreadcrumb(Breadcrumb::create(
            category: $category,
            message: $message,
            level: $level,
            data: $data,
        ));
    }

    /**
     * @return Breadcrumb[]
     */
    public function getBreadcrumbs(): array
    {
        return $this->breadcrumbs;
    }

    public function clearBreadcrumbs(): void
    {
        $this->breadcrumbs = [];
    }

    public function setMaxBreadcrumbs(int $max): void
    {
        $this->maxBreadcrumbs = $max;
    }
}
