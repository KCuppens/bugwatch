# frozen_string_literal: true

module Bugwatch
  module Level
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"
    DEBUG = "debug"
    FATAL = "fatal"
  end

  class StackFrame
    attr_accessor :filename, :lineno, :function, :in_app

    def initialize(filename: nil, lineno: nil, function: nil, in_app: true)
      @filename = filename
      @lineno = lineno
      @function = function
      @in_app = in_app
    end

    def to_h
      {
        filename: @filename,
        lineno: @lineno,
        function: @function,
        in_app: @in_app
      }
    end
  end

  class ExceptionInfo
    attr_accessor :type, :value, :stacktrace

    def initialize(type: nil, value: nil, stacktrace: [])
      @type = type
      @value = value
      @stacktrace = stacktrace
    end

    def to_h
      {
        type: @type,
        value: @value,
        stacktrace: @stacktrace.map(&:to_h)
      }
    end
  end

  class ErrorEvent
    attr_accessor :event_id, :timestamp, :level, :message, :exception, :environment,
                  :release, :fingerprint, :tags, :extras, :user, :request, :breadcrumbs,
                  :sdk, :platform

    def initialize
      @event_id = generate_event_id
      @timestamp = Time.now.utc.iso8601
      @level = Level::ERROR
      @platform = "ruby"
      @sdk = { name: "bugwatch-ruby", version: Bugwatch::VERSION }
      @tags = {}
      @extras = {}
      @breadcrumbs = []
    end

    def to_h
      hash = {
        event_id: @event_id,
        timestamp: @timestamp,
        level: @level,
        platform: @platform,
        sdk: @sdk,
        tags: @tags,
        extras: @extras,
        breadcrumbs: @breadcrumbs
      }
      hash[:message] = @message if @message
      hash[:exception] = @exception.to_h if @exception
      hash[:environment] = @environment if @environment
      hash[:release] = @release if @release
      hash[:fingerprint] = @fingerprint if @fingerprint
      hash[:user] = @user if @user
      hash[:request] = @request if @request
      hash
    end

    private

    def generate_event_id
      SecureRandom.uuid.delete("-")
    end
  end
end
