package io.github.nplho98.secretarytool;
import org.junit.Test;
import static org.junit.Assert.*;
import java.time.*;
import java.util.*;

public class ReminderLogicTest {
    private final ZoneId zone=ZoneId.of("Asia/Taipei");
    private final Instant now=ZonedDateTime.of(2026,11,9,23,56,0,0,zone).toInstant();
    private ReminderLogic.Source meeting(){
        ReminderLogic.Source s=new ReminderLogic.Source();s.id="m";s.title="測試";s.kind="meeting";
        s.weekdays.add(2);s.time="00:05";s.updated=now.minusSeconds(86400);return s;
    }
    private List<ReminderLogic.Occurrence> rows(ReminderLogic.Source s){return ReminderLogic.occurrences(Collections.singletonList(s),10,now,zone);}
    @Test public void monthlyWeeks(){
        LocalDate first=LocalDate.of(2026,12,1),second=LocalDate.of(2026,12,8);
        LocalDate last=LocalDate.of(2026,12,29),previous=LocalDate.of(2026,12,22);
        assertTrue(ReminderLogic.monthWeekMatches(first,Collections.singleton(1)));
        assertFalse(ReminderLogic.monthWeekMatches(second,Collections.singleton(1)));
        assertTrue(ReminderLogic.monthWeekMatches(last,Collections.singleton(-1)));
        assertFalse(ReminderLogic.monthWeekMatches(previous,Collections.singleton(-1)));
        for(LocalDate day:Arrays.asList(first,second,last,previous)) {
            assertTrue(ReminderLogic.monthWeekMatches(day,Collections.emptySet()));
            assertTrue(ReminderLogic.monthWeekMatches(day,null));
            for(int week:new int[]{1,-1,0}) {
                ReminderLogic.Source s=meeting();
                if(week!=0)s.monthWeeks.add(week);
                boolean expected=week==0 || (week==1?day.equals(first):day.equals(last));
                assertEquals(expected,!ReminderLogic.occurrences(Collections.singletonList(s),10,
                        day.atStartOfDay(zone).toInstant(),zone).isEmpty());
            }
        }
    }
    @Test public void parseOffsetAndUtcTimestamps(){
        Instant expected=Instant.ofEpochSecond(1794184200L,123456000);
        assertEquals(expected,ReminderLogic.parseInstant("2026-11-09T00:30:00.123456+00:00"));
        assertEquals(expected,ReminderLogic.parseInstant("2026-11-09T00:30:00.123456Z"));
        assertEquals(Instant.ofEpochSecond(1794184200L),ReminderLogic.parseInstant("2026-11-09T00:30:00Z"));
    }
    @Test public void midnightAndWeekday(){
        ReminderLogic.Source s=meeting();assertEquals(1,rows(s).size());ReminderLogic.Occurrence o=rows(s).get(0);
        assertEquals(LocalDate.of(2026,11,10),o.occurs.atZone(zone).toLocalDate());
        assertTrue(ReminderLogic.decide(o,now,zone).soon);assertTrue(ReminderLogic.decide(o,now,zone).ensure);
        s.weekdays.clear();s.weekdays.add(3);assertTrue(rows(s).isEmpty());
        s=meeting();s.enabled=false;assertTrue(rows(s).isEmpty());
    }
    @Test public void speechWindowsAndCatchUp(){
        ReminderLogic.Occurrence o=rows(meeting()).get(0);
        assertFalse(ReminderLogic.decide(o,o.occurs.minusSeconds(660),zone).ensure);
        assertTrue(ReminderLogic.decide(o,o.occurs.minusSeconds(600),zone).soon);
        assertTrue(ReminderLogic.decide(o,o.occurs.minusSeconds(300),zone).soon);
        assertFalse(ReminderLogic.decide(o,o.occurs.minusSeconds(240),zone).soon);
        assertTrue(ReminderLogic.decide(o,o.occurs,zone).due);
        assertTrue(ReminderLogic.decide(o,o.occurs.plusSeconds(300),zone).due);
        ReminderLogic.Decision late=ReminderLogic.decide(o,o.occurs.plusSeconds(360),zone);
        assertTrue(late.ensure);assertFalse(late.soon);assertFalse(late.due);
        assertTrue(ReminderLogic.decide(o,o.occurs.plusSeconds(43200),zone).ensure);
        assertFalse(ReminderLogic.decide(o,o.occurs.plusSeconds(86400),zone).ensure);
    }
    @Test public void noRetroactiveMeetingsOrTodos(){
        ReminderLogic.Source s=meeting();s.updated=rows(s).get(0).occurs.plusSeconds(1);assertTrue(rows(s).isEmpty());
        s=new ReminderLogic.Source();s.kind="todo";s.id="t";s.title="待辦";s.due=now.plusSeconds(600);s.created=now.minusSeconds(100);
        assertEquals(1,rows(s).size());s.done=true;assertTrue(rows(s).isEmpty());
        s.done=false;s.created=s.due.plusSeconds(1);assertTrue(rows(s).isEmpty());
        s.due=null;assertTrue(rows(s).isEmpty());
    }
    @Test public void roundingAndNextEvent(){
        ReminderLogic.Occurrence o=rows(meeting()).get(0);
        assertEquals(9,ReminderLogic.decide(o,o.occurs.minusSeconds(510),zone).minutes);
        assertEquals(o.occurs,ReminderLogic.nextEvent(Collections.singletonList(o),o.occurs.minusSeconds(10),zone));
        assertTrue(ReminderLogic.nextEvent(Collections.emptyList(),now,zone).isAfter(now));
    }
}
