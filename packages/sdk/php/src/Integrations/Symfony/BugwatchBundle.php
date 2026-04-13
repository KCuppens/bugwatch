<?php

declare(strict_types=1);

namespace Bugwatch\Integrations\Symfony;

use Bugwatch\Bugwatch;
use Bugwatch\Options;
use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator;
use Symfony\Component\HttpKernel\Bundle\AbstractBundle;

final class BugwatchBundle extends AbstractBundle
{
    public function loadExtension(array $config, ContainerConfigurator $container, ContainerBuilder $builder): void
    {
        $container->services()
            ->set(EventSubscriber::class)
            ->autoconfigure()
            ->autowire();
    }

    public function boot(): void
    {
        /** @var \Symfony\Component\DependencyInjection\ContainerInterface $container */
        $container = $this->container;

        Bugwatch::init(new Options(
            apiKey: (string) ($container->hasParameter('bugwatch.api_key')
                ? $container->getParameter('bugwatch.api_key')
                : (getenv('BUGWATCH_API_KEY') ?: '')),
            environment: $container->hasParameter('kernel.environment')
                ? (string) $container->getParameter('kernel.environment')
                : null,
            serverUrl: (string) ($container->hasParameter('bugwatch.server_url')
                ? $container->getParameter('bugwatch.server_url')
                : 'https://api.bugwatch.dev'),
            debug: (bool) ($container->hasParameter('bugwatch.debug')
                ? $container->getParameter('bugwatch.debug')
                : false),
        ));
    }
}
