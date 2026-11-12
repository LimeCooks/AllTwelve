import type { ReactNode } from 'react';
import { ArrowRight, CalendarDays, Layers, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Event = { id: string; title: string; startsAt: string; location: string };

export function TeamHome({
  greeting,
  team,
  season,
  crest,
  nextGame,
  events,
  film,
  play,
  items,
  onNavigate,
}: {
  greeting: string;
  team: string;
  season: string;
  crest: ReactNode;
  nextGame?: Event;
  events: Event[];
  film: ReactNode;
  play: ReactNode;
  items: { id: string; title: string }[];
  onNavigate: (view: string) => void;
}) {
  return (
    <div className="team-home">
      <header className="team-home-heading">
        <p className="eyebrow">Team home</p>
        <h1>{greeting}</h1>
        <p>Your team. Ready for the next snap.</p>
      </header>
      <button className="team-home-game" onClick={() => onNavigate('Calendar')}>
        <span className="team-home-label">Next game</span>
        <span className="team-home-identity">
          {crest}
          <span>
            <strong>{team}</strong>
            <small>{season}</small>
          </span>
        </span>
        <span className="team-home-game-name">
          {nextGame?.title || 'Schedule your next game'}
        </span>
        <span>
          <CalendarDays />
          {nextGame
            ? new Date(nextGame.startsAt).toLocaleString([], {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })
            : 'Open Calendar'}
        </span>
        {nextGame?.location && (
          <span>
            <MapPin />
            {nextGame.location}
          </span>
        )}
        <ArrowRight />
      </button>
      <div className="team-home-work">
        <section className="team-home-recent">
          <header>
            <h2>Recent work</h2>
          </header>
          <div className="team-home-previews">
            <article>
              {film}
              <div>
                <span className="team-home-label">Film</span>
                <button onClick={() => onNavigate('Film Room')}>
                  Team film library <ArrowRight />
                </button>
                <p>Review saved footage and charted clips.</p>
              </div>
            </article>
            <article>
              {play}
              <div>
                <span className="team-home-label">Playbook</span>
                <button onClick={() => onNavigate('Playbook')}>
                  Team play library <ArrowRight />
                </button>
                <p>Build, teach, and install your plays.</p>
              </div>
            </article>
          </div>
        </section>
        <section className="team-home-schedule">
          <header>
            <h2>Upcoming schedule</h2>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open calendar"
              onClick={() => onNavigate('Calendar')}
            >
              <ArrowRight />
            </Button>
          </header>
          {events.length ? (
            events.slice(0, 4).map((event) => (
              <button
                key={event.id}
                aria-label={`Open ${event.title} in Calendar`}
                onClick={() => onNavigate('Calendar')}
              >
                <time dateTime={event.startsAt}>
                  <span>
                    {new Date(event.startsAt).toLocaleDateString([], {
                      weekday: 'short',
                    })}
                  </span>
                  <strong>
                    {new Date(event.startsAt).toLocaleDateString([], {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </strong>
                </time>
                <span>
                  <strong>{event.title}</strong>
                  <small>
                    {new Date(event.startsAt).toLocaleTimeString([], {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                    {event.location ? ` · ${event.location}` : ''}
                  </small>
                </span>
              </button>
            ))
          ) : (
            <div className="team-home-empty">
              <CalendarDays />
              <strong>No upcoming events</strong>
              <p>Add a game, practice, or install to your team calendar.</p>
              <Button variant="outline" onClick={() => onNavigate('Calendar')}>
                Open Calendar
              </Button>
            </div>
          )}
        </section>
      </div>
      <section className="team-home-installs">
        <header>
          <h2>Install assignments</h2>
          <Button variant="ghost" onClick={() => onNavigate('Install')}>
            Open Install <ArrowRight />
          </Button>
        </header>
        {items.length ? (
          <div>
            {items.slice(0, 4).map((item) => (
              <button key={item.id} onClick={() => onNavigate('Install')}>
                <Layers />
                <strong>{item.title}</strong>
                <ArrowRight />
              </button>
            ))}
          </div>
        ) : (
          <div className="team-home-install-empty">
            <Layers />
            <p>
              No install assignments yet. Organize teaching around your team’s
              own schedule.
            </p>
            <Button variant="outline" onClick={() => onNavigate('Install')}>
              Create an install
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
