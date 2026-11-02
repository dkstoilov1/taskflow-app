package com.taskflow.backend.task.persistence;

import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;

/**
 * PostgreSQL implementation of the task literal-search repository fragment.
 */
public class TaskSearchRepositoryImpl implements TaskSearchRepository {

    private static final String LIST_SQL = """
            SELECT *
            FROM tasks
            ORDER BY created_at DESC, id DESC
            LIMIT :limit OFFSET :offset
            """;

    private static final String COUNT_ALL_SQL = "SELECT COUNT(*) FROM tasks";

    private static final String SEARCH_SQL = """
            SELECT *
            FROM tasks
            WHERE title ILIKE :pattern ESCAPE E'\\\\'
               OR description ILIKE :pattern ESCAPE E'\\\\'
            ORDER BY created_at DESC, id DESC
            LIMIT :limit OFFSET :offset
            """;

    private static final String COUNT_SQL = """
            SELECT COUNT(*)
            FROM tasks
            WHERE title ILIKE :pattern ESCAPE E'\\\\'
               OR description ILIKE :pattern ESCAPE E'\\\\'
            """;

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
    public Page<TaskEntity> listAllTasks(Pageable pageable) {
        Query contentQuery = entityManager.createNativeQuery(LIST_SQL, TaskEntity.class)
                .setParameter("limit", pageable.getPageSize())
                .setParameter("offset", pageable.getOffset());
        List<TaskEntity> tasks = contentQuery.getResultList();
        Number count = (Number) entityManager.createNativeQuery(COUNT_ALL_SQL).getSingleResult();
        return new PageImpl<>(tasks, pageable, count.longValue());
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @SuppressWarnings("unchecked")
    public Page<TaskEntity> searchLiteral(String query, Pageable pageable) {
        String pattern = "%" + escapeLikeWildcards(query) + "%";
        Query contentQuery = entityManager.createNativeQuery(SEARCH_SQL, TaskEntity.class)
                .setParameter("pattern", pattern)
                .setParameter("limit", pageable.getPageSize())
                .setParameter("offset", pageable.getOffset());
        List<TaskEntity> tasks = contentQuery.getResultList();
        Number count = (Number) entityManager.createNativeQuery(COUNT_SQL)
                .setParameter("pattern", pattern)
                .getSingleResult();
        return new PageImpl<>(tasks, pageable, count.longValue());
    }

    private static String escapeLikeWildcards(String query) {
        return query.replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_");
    }
}
