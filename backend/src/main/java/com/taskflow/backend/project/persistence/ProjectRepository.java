package com.taskflow.backend.project.persistence;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Persistence boundary for projects and project-scoped aggregate reads.
 */
public interface ProjectRepository extends JpaRepository<ProjectEntity, UUID> {

    /**
     * Reads all projects in the contract's case-insensitive name and ID order.
     *
     * @return every project, including projects with no tasks
     */
    @Query("SELECT p FROM ProjectEntity p ORDER BY LOWER(p.name), p.id")
    List<ProjectEntity> findAllInDisplayOrder();

    /**
     * Locks a project row to serialize assignment, rename, and deletion operations.
     *
     * @param id project UUID
     * @return locked project, if it exists
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT p FROM ProjectEntity p WHERE p.id = :id")
    Optional<ProjectEntity> findByIdForUpdate(@Param("id") UUID id);

    /**
     * Counts names equal without regard to case.
     *
     * @param name normalized candidate name
     * @return matching project count
     */
    @Query(value = "SELECT COUNT(*) FROM projects WHERE lower(name) = lower(:name)", nativeQuery = true)
    long countByNameIgnoreCase(@Param("name") String name);

    /**
     * Counts case-insensitive name matches excluding one project.
     *
     * @param name normalized candidate name
     * @param id project that may retain its current name
     * @return matching project count excluding the specified project
     */
    @Query(value = """
            SELECT COUNT(*)
            FROM projects
            WHERE lower(name) = lower(:name)
              AND id <> :id
            """, nativeQuery = true)
    long countByNameIgnoreCaseAndIdNot(@Param("name") String name, @Param("id") UUID id);

    /**
     * Renames a project and advances its version only if the expected version remains current.
     *
     * @param id project UUID
     * @param expectedVersion current client version
     * @param name normalized replacement name
     * @return one when updated, or zero when the version no longer matches
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
            UPDATE projects
            SET name = :name, version = version + 1
            WHERE id = :id AND version = :expectedVersion
            """, nativeQuery = true)
    int renameIfVersionMatches(
            @Param("id") UUID id,
            @Param("expectedVersion") int expectedVersion,
            @Param("name") String name);

    /**
     * Deletes a project only when its current version matches the supplied version.
     *
     * @param id project UUID
     * @param expectedVersion current client version
     * @return one when deleted, or zero when the version no longer matches
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = "DELETE FROM projects WHERE id = :id AND version = :expectedVersion", nativeQuery = true)
    int deleteIfVersionMatches(@Param("id") UUID id, @Param("expectedVersion") int expectedVersion);

    /**
     * Aggregates task counts for every project, preserving empty projects.
     *
     * @return rows containing project UUID, name, total tasks, and completed tasks
     */
    @Query(value = """
            SELECT p.id, p.name, COUNT(t.id),
                   COUNT(t.id) FILTER (WHERE t.status = 'completed')
            FROM projects p
            LEFT JOIN tasks t ON t.project_id = p.id
            GROUP BY p.id, p.name
            ORDER BY lower(p.name), p.id
            """, nativeQuery = true)
    List<Object[]> projectTaskAggregates();
}
