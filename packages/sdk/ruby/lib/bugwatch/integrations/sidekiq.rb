# frozen_string_literal: true

module Bugwatch
  module Sidekiq
    class ErrorHandler
      def call(exception, context = {})
        Bugwatch.capture_exception(exception, context: {
          sidekiq: context,
          job_class: context[:job]&.fetch("class", nil),
          queue: context[:job]&.fetch("queue", nil),
          jid: context[:job]&.fetch("jid", nil)
        })
      end
    end

    def self.setup!
      return unless defined?(::Sidekiq)

      ::Sidekiq.configure_server do |config|
        config.error_handlers << ErrorHandler.new
      end
    end
  end
end

# Auto-register when loaded
Bugwatch::Sidekiq.setup!
