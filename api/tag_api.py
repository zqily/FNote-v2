from sqlite3 import IntegrityError
import logging

logger = logging.getLogger(__name__)

class TagApi:
    def __init__(self, db_handler):
        self.db = db_handler

    def create_tag(self, name, category_id):
        """Creates a new user-defined tag in a given category."""
        try:
            new_tag = self.db.create_tag(name, category_id)
            logger.info(f"Created new tag '{name}' (ID: {new_tag['id']}) in category {category_id}.")
            return {'status': 'success', 'tag': new_tag}
        except IntegrityError:
            logger.warning(f"Attempted to create duplicate tag '{name}' in category {category_id}.")
            return {'status': 'error', 'message': 'This tag already exists in this category.'}
        except Exception as e:
            logger.error(f"Error creating tag '{name}': {e}", exc_info=True)
            return {'status': 'error', 'message': str(e)}

    def rename_tag(self, tag_id, new_name):
        """Renames a user-defined tag and returns the updated tag data."""
        try:
            self.db.rename_tag(int(tag_id), new_name)
            with self.db._get_db_conn() as conn:
                updated_tag_data = self.db._get_all_tags(conn.cursor())
            logger.info(f"Renamed tag ID {tag_id} to '{new_name}'.")
            return {'status': 'success', 'tagData': updated_tag_data}
        except ValueError as e:
            logger.warning(f"Error renaming tag ID {tag_id}: {e}")
            return {'status': 'error', 'message': str(e)}
        except IntegrityError:
            logger.warning(f"Failed to rename tag to '{new_name}': name already exists in category.")
            return {'status': 'error', 'message': f'Tag name "{new_name}" already exists in this category.'}
        except Exception as e:
            logger.error(f"Unexpected error renaming tag ID {tag_id}: {e}", exc_info=True)
            return {'status': 'error', 'message': 'An unexpected error occurred.'}

    def delete_tag(self, tag_id):
        """Deletes a user-defined tag and returns the updated tag data."""
        try:
            self.db.delete_tag(int(tag_id))
            with self.db._get_db_conn() as conn:
                updated_tag_data = self.db._get_all_tags(conn.cursor())
            logger.info(f"Deleted tag ID {tag_id}.")
            return {'status': 'success', 'tagData': updated_tag_data}
        except ValueError as e:
            logger.warning(f"Error deleting tag ID {tag_id}: {e}")
            return {'status': 'error', 'message': str(e)}
        except Exception as e:
            logger.error(f"Unexpected error deleting tag ID {tag_id}: {e}", exc_info=True)
            return {'status': 'error', 'message': 'An unexpected error occurred.'}

    def merge_tags(self, source_tag_id, dest_tag_id):
        """Merges two tags and returns all data necessary for a frontend update."""
        try:
            result = self.db.merge_tags(int(source_tag_id), int(dest_tag_id))
            logger.info(f"Merged tag ID {source_tag_id} into {dest_tag_id}.")
            return {'status': 'success', **result}
        except ValueError as e:
            logger.warning(f"Error merging tags ({source_tag_id} -> {dest_tag_id}): {e}")
            return {'status': 'error', 'message': str(e)}
        except Exception as e:
            logger.error(f"Unexpected error merging tags ({source_tag_id} -> {dest_tag_id}): {e}", exc_info=True)
            return {'status': 'error', 'message': 'An unexpected error occurred.'}