# frozen_string_literal: true

module Bugwatch
  class Scope
    attr_reader :user, :tags, :extras, :breadcrumbs

    def initialize
      @user = nil
      @tags = {}
      @extras = {}
      @breadcrumbs = []
    end

    def set_user(user_hash)
      @user = user_hash
      self
    end

    def set_tags(tags_hash)
      @tags.merge!(tags_hash)
      self
    end

    def set_extras(extras_hash)
      @extras.merge!(extras_hash)
      self
    end

    def add_breadcrumb(category:, message:, data: {}, level: Level::INFO)
      @breadcrumbs << {
        category: category,
        message: message,
        data: data,
        level: level,
        timestamp: Time.now.utc.iso8601
      }

      # Keep only last 100 breadcrumbs
      @breadcrumbs = @breadcrumbs.last(100)
      self
    end

    def clear
      @user = nil
      @tags = {}
      @extras = {}
      @breadcrumbs = []
      self
    end

    def apply_to_event(event)
      event.user = @user if @user
      event.tags = event.tags.merge(@tags) unless @tags.empty?
      event.extras = event.extras.merge(@extras) unless @extras.empty?
      event.breadcrumbs = @breadcrumbs.dup unless @breadcrumbs.empty?
      event
    end

    def self.current
      Thread.current[:bugwatch_scope] ||= new
    end

    def self.current=(scope)
      Thread.current[:bugwatch_scope] = scope
    end
  end
end
