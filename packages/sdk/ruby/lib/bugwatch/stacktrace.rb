# frozen_string_literal: true

module Bugwatch
  module StacktraceParser
    GEM_PATHS = [
      "/gems/",
      "/rubygems/",
      "/lib/ruby/",
      "/vendor/bundle/",
      "/bundler/gems/"
    ].freeze

    BACKTRACE_REGEX = /\A(.+):(\d+):in `(.+)'\z/

    def self.parse(exception)
      return [] unless exception.respond_to?(:backtrace) && exception.backtrace

      exception.backtrace.map do |line|
        parse_line(line)
      end.compact
    end

    def self.parse_line(line)
      match = line.match(BACKTRACE_REGEX)
      return nil unless match

      filename = match[1]
      lineno = match[2].to_i
      function = match[3]

      StackFrame.new(
        filename: filename,
        lineno: lineno,
        function: function,
        in_app: in_app?(filename)
      )
    end

    def self.in_app?(filename)
      GEM_PATHS.none? { |path| filename.include?(path) }
    end
  end
end
