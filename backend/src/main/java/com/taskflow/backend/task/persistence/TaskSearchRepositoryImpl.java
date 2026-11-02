package com.taskflow.backend.task.persistence;

import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;

/**
 * PostgreSQL implementation of task search and aggregate query fragments.
 */
public class TaskSearchRepositoryImpl implements TaskSearchRepository {

    private final EntityManager entityManager;

    /**
     * Creates the PostgreSQL task query fragment.
     *
     * @param entityManager JPA entity manager used for native paginated queries
     */
    public TaskSearchRepositoryImpl(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @SuppressWarnings("unchecked")
    public Page<TaskEntity> searchTasks(TaskSearchCriteria criteria, Pageable pageable) {
        String whereClause = whereClause(criteria);
        String fromAndWhere = " FROM tasks WHERE " + whereClause;
        Query contentQuery = entityManager.createNativeQuery(
                        "SELECT *" + fromAndWhere + " ORDER BY " + orderBy(criteria.sort())
                                + " LIMIT :limit OFFSET :offset",
                        TaskEntity.class);
        Query countQuery = entityManager.createNativeQuery("SELECT COUNT(*)" + fromAndWhere);
        bindFilters(contentQuery, criteria);
        bindFilters(countQuery, criteria);
        contentQuery.setParameter("limit", pageable.getPageSize());
        contentQuery.setParameter("offset", pageable.getOffset());
        List<TaskEntity> tasks = contentQuery.getResultList();
        Number count = (Number) countQuery.getSingleResult();
        return new PageImpl<>(tasks, pageable, count.longValue());
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public long countCompletedBetween(Instant start, Instant end) {
        Number count = (Number) entityManager.createNativeQuery("""
                SELECT COUNT(*)
                FROM tasks
                WHERE status = 'completed'
                  AND completed_at >= :start
                  AND completed_at < :end
                """)
                .setParameter("start", start)
                .setParameter("end", end)
                .getSingleResult();
        return count.longValue();
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @SuppressWarnings("unchecked")
    public List<Object[]> dailyCompletions(Instant start, Instant end, String timeZone) {
        return entityManager.createNativeQuery("""
                SELECT DATE(completed_at AT TIME ZONE :timeZone), COUNT(*)
                FROM tasks
                WHERE status = 'completed'
                  AND completed_at >= :start
                  AND completed_at < :end
                GROUP BY 1
                """)
                .setParameter("timeZone", timeZone)
                .setParameter("start", start)
                .setParameter("end", end)
                .getResultList();
    }

    private static String whereClause(TaskSearchCriteria criteria) {
        List<String> conditions = new ArrayList<>();
        conditions.add("1 = 1");
        addTextFilter(conditions, criteria.query());
        addViewFilter(conditions, criteria);
        addStatusFilter(conditions, criteria.status());
        addPriorityFilter(conditions, criteria.priority());
        addDueFilter(conditions, criteria.due(), criteria);
        addProjectFilter(conditions, criteria);
        return String.join(" AND ", conditions);
    }

    private static void addTextFilter(List<String> conditions, String query) {
        if (query != null && !query.isEmpty()) {
            conditions.add("(title ILIKE :pattern ESCAPE E'\\\\' OR description ILIKE :pattern ESCAPE E'\\\\')");
        }
    }

    private static void addViewFilter(List<String> conditions, TaskSearchCriteria criteria) {
        switch (criteria.view()) {
            case "today" -> conditions.add("status = 'active' AND due_date <= :today");
            case "upcoming" -> conditions.add("status = 'active' AND due_date > :today");
            case "completed" -> conditions.add("status = 'completed'");
            default -> {
            }
        }
    }

    private static void addStatusFilter(List<String> conditions, String status) {
        if (status != null) {
            conditions.add("status = :status");
        }
    }

    private static void addPriorityFilter(List<String> conditions, String priority) {
        if (priority != null) {
            conditions.add("priority = :priority");
        }
    }

    private static void addDueFilter(List<String> conditions, String due, TaskSearchCriteria criteria) {
        if (due == null) {
            return;
        }
        switch (due) {
            case "today" -> conditions.add("due_date = :today");
            case "this_week" -> conditions.add("due_date BETWEEN :weekStart AND :weekEnd");
            case "overdue" -> conditions.add("due_date < :today");
            default -> {
            }
        }
    }

    private static void addProjectFilter(List<String> conditions, TaskSearchCriteria criteria) {
        if (criteria.unassigned()) {
            conditions.add("project_id IS NULL");
        } else if (criteria.projectId() != null) {
            conditions.add("project_id = :projectId");
        }
    }

    private static void bindFilters(Query query, TaskSearchCriteria criteria) {
        if (criteria.query() != null && !criteria.query().isEmpty()) {
            query.setParameter("pattern", "%" + escapeLikeWildcards(criteria.query()) + "%");
        }
        if (requiresToday(criteria)) {
            query.setParameter("today", criteria.today());
        }
        if ("this_week".equals(criteria.due())) {
            query.setParameter("weekStart", criteria.weekStart());
            query.setParameter("weekEnd", criteria.weekEnd());
        }
        if (criteria.status() != null) {
            query.setParameter("status", criteria.status());
        }
        if (criteria.priority() != null) {
            query.setParameter("priority", criteria.priority());
        }
        if (criteria.projectId() != null && !criteria.unassigned()) {
            query.setParameter("projectId", criteria.projectId());
        }
    }

    private static boolean requiresToday(TaskSearchCriteria criteria) {
        return !"all".equals(criteria.view()) && !"completed".equals(criteria.view())
                || "today".equals(criteria.due()) || "overdue".equals(criteria.due());
    }

    private static String orderBy(String sort) {
        return switch (sort) {
            case "due_asc" -> "due_date ASC NULLS LAST, created_at DESC, id DESC";
            case "due_desc" -> "due_date DESC NULLS LAST, created_at DESC, id DESC";
            case "priority_desc" -> "CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, created_at DESC, id DESC";
            case "priority_asc" -> "CASE priority WHEN 'low' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, created_at DESC, id DESC";
            case "status_asc" -> "CASE status WHEN 'active' THEN 0 ELSE 1 END, created_at DESC, id DESC";
            case "status_desc" -> "CASE status WHEN 'completed' THEN 0 ELSE 1 END, created_at DESC, id DESC";
            default -> "created_at DESC, id DESC";
        };
    }

    private static String escapeLikeWildcards(String query) {
        return query.replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_");
    }
}
