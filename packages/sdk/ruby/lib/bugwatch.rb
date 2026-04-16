# frozen_string_literal: true

require "securerandom"
require "json"

require_relative "bugwatch/version"
require_relative "bugwatch/options"
require_relative "bugwatch/types"
require_relative "bugwatch/fingerprint"
require_relative "bugwatch/stacktrace"
require_relative "bugwatch/scope"
require_relative "bugwatch/transport"
require_relative "bugwatch/client"
require_relative "bugwatch/integrations/rack"

# Auto-load framework integrations if present
require_relative "bugwatch/integrations/rails" if defined?(Rails::Railtie)
require_relative "bugwatch/integrations/sidekiq" if defined?(Sidekiq)

module Bugwatch
  class << self
    def init(options = {})
      @mutex ||= Mutex.new
      @mutex.synchronize do
        config = configuration
        options.each do |key, value|
          setter = :"#{key}="
          config.public_send(setter, value) if config.respond_to?(setter)
        end
        @client = Client.new(config)
      end
    end

    def capture_exception(exception, context: {})
      return unless configured?

      client.capture_exception(exception, context: context)
    end

    def capture_message(message, level: :error, context: {})
      return unless configured?

      client.capture_message(message, level: level, context: context)
    end

    def configured?
      !@client.nil? && configuration.valid?
    end

    def flush
      @client&.flush
    end

    def close
      @client&.close
      @client = nil
    end

    def configuration
      @configuration ||= Configuration.new
    end

    def configure
      yield configuration if block_given?
      init
    end

    # For testing: reset all state
    def reset!
      @mutex&.synchronize do
        @client&.close
        @client = nil
        @configuration = nil
      end
    end

    private

    attr_reader :client
  end
end
