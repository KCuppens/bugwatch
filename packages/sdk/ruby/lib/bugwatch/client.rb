# frozen_string_literal: true

module Bugwatch
  class Client
    attr_reader :configuration, :transport

    def initialize(configuration)
      @configuration = configuration
      @transport = if configuration.valid?
                     HttpTransport.new(
                       api_key: configuration.api_key,
                       server_url: configuration.server_url,
                       debug: configuration.debug
                     )
                   else
                     NoopTransport.new
                   end
    end

    def capture_exception(exception, context: {})
      return unless @configuration.valid?

      event = build_exception_event(exception, context)
      process_and_send(event)
    end

    def capture_message(message, level: :error, context: {})
      return unless @configuration.valid?

      event = build_message_event(message, level, context)
      process_and_send(event)
    end

    def flush
      @transport.flush
    end

    def close
      @transport.close
    end

    # Allow replacing transport (useful for testing)
    def transport=(transport)
      @transport = transport
    end

    private

    def build_exception_event(exception, context)
      event = ErrorEvent.new
      event.level = Level::ERROR
      event.environment = @configuration.environment
      event.release = @configuration.release

      frames = StacktraceParser.parse(exception)
      event.exception = ExceptionInfo.new(
        type: exception.class.name,
        value: exception.message,
        stacktrace: frames
      )

      event.extras = context unless context.empty?
      event.fingerprint = Fingerprint.generate(event)

      Scope.current.apply_to_event(event)
      event
    end

    def build_message_event(message, level, context)
      event = ErrorEvent.new
      event.message = message
      event.level = normalize_level(level)
      event.environment = @configuration.environment
      event.release = @configuration.release
      event.extras = context unless context.empty?
      event.fingerprint = Fingerprint.generate(event)

      Scope.current.apply_to_event(event)
      event
    end

    def process_and_send(event)
      if @configuration.before_send
        event = @configuration.before_send.call(event)
        return nil unless event
      end

      event_hash = event.to_h
      @transport.send_event(event_hash)
      event.event_id
    end

    def normalize_level(level)
      case level.to_s
      when "error" then Level::ERROR
      when "warning", "warn" then Level::WARNING
      when "info" then Level::INFO
      when "debug" then Level::DEBUG
      when "fatal" then Level::FATAL
      else Level::ERROR
      end
    end
  end
end
